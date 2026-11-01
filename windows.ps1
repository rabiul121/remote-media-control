param([Parameter(Mandatory=$true)][string]$Action)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$payloadText = [Console]::In.ReadToEnd()
$payload = if ($payloadText) { $payloadText | ConvertFrom-Json } else { [pscustomobject]@{} }

# Actions that need no native helpers run first, so they skip the C# compile below.
if ($Action -eq 'browse') {
  $requested=[string]$payload.path
  if(!$requested) {
    $drives=@(Get-PSDrive -PSProvider FileSystem | ForEach-Object { [pscustomobject]@{name=$_.Name;path=$_.Root;kind='drive'} })
    [pscustomobject]@{path='';parent='';drives=$drives;folders=@();files=@()} | ConvertTo-Json -Compress -Depth 5
  } else {
    $item=Get-Item -LiteralPath $requested -ErrorAction Stop
    if(!$item.PSIsContainer){throw 'That path is not a folder.'}
    $folders=@(Get-ChildItem -LiteralPath $item.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=$_.Name;path=$_.FullName;kind='folder'} })
    $extensions=@($payload.mediaExtensions | ForEach-Object { $_.ToLowerInvariant() })
    $files=@(Get-ChildItem -LiteralPath $item.FullName -File -ErrorAction SilentlyContinue | ForEach-Object { $ext=$_.Extension.ToLowerInvariant(); if($extensions -contains $ext){[pscustomobject]@{name=$_.Name;path=$_.FullName;kind='media';bytes=$_.Length}}else{[pscustomobject]@{name=$_.Name;path=$_.FullName;kind='file';bytes=$_.Length}} })
    [pscustomobject]@{path=$item.FullName;parent=$item.Parent.FullName;drives=@();folders=$folders;files=$files} | ConvertTo-Json -Compress -Depth 5
  }
  exit 0
}

if ($Action -eq 'apps') {
  # Start-menu entries (desktop programs and Store apps). Each AppID can be
  # started with shell:AppsFolder\<AppID>.
  if (-not (Get-Command Get-StartApps -ErrorAction SilentlyContinue)) { throw 'This version of Windows cannot list installed apps.' }
  $seen=@{}
  $items=@(Get-StartApps | ForEach-Object {
    $name=([string]$_.Name).Trim(); $appId=([string]$_.AppID).Trim()
    # Uninstall shortcuts are hidden so they cannot be started by a stray tap.
    if($name -and $appId -and $name -notmatch '^uninstall\b' -and -not $seen.ContainsKey($appId)){ $seen[$appId]=$true; [pscustomobject]@{name=$name;appId=$appId} }
  })
  [Console]::Out.Write((ConvertTo-Json -InputObject $items -Compress -Depth 3))
  exit 0
}

$native = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class WinAudio {
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort virtualKey; public ushort scanCode; public uint flags; public uint time; public UIntPtr extraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx; public int dy; public uint data; public uint flags; public uint time; public UIntPtr extraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KeyboardInput keyboard; [FieldOffset(0)] public MouseInput mouse; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion value; }
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetFocus();
  [DllImport("user32.dll")] static extern short GetKeyState(int key);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd,System.Text.StringBuilder text,int maxCount);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint processId);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd,uint message,IntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint mapType);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd,uint message,IntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static IntPtr ForegroundHandle() { return GetForegroundWindow(); }
  public static string WindowTitle(long handle) { var text=new System.Text.StringBuilder(512); GetWindowText(new IntPtr(handle),text,text.Capacity); return text.ToString(); }
  public static uint WindowProcessId(long handle) { uint id; GetWindowThreadProcessId(new IntPtr(handle),out id); return id; }
  public static bool ActivateWindow(long handle) {
    var h=new IntPtr(handle); if(!IsWindow(h))return false; if(IsIconic(h))ShowWindowAsync(h,9);
    uint foregroundPid,targetPid; var foreground=GetForegroundWindow(); uint current=GetCurrentThreadId();
    uint foregroundThread=foreground==IntPtr.Zero?0:GetWindowThreadProcessId(foreground,out foregroundPid);
    uint targetThread=GetWindowThreadProcessId(h,out targetPid); bool attachForeground=false,attachTarget=false;
    try {
      if(foregroundThread!=0&&foregroundThread!=current)attachForeground=AttachThreadInput(current,foregroundThread,true);
      if(targetThread!=0&&targetThread!=current&&targetThread!=foregroundThread)attachTarget=AttachThreadInput(current,targetThread,true);
      BringWindowToTop(h); SetForegroundWindow(h);
    } finally {
      if(attachTarget)AttachThreadInput(current,targetThread,false);
      if(attachForeground)AttachThreadInput(current,foregroundThread,false);
    }
    System.Threading.Thread.Sleep(60); return GetForegroundWindow()==h;
  }
  public static bool WindowExists(long handle) { return handle!=0 && IsWindow(new IntPtr(handle)); }
  public static bool IsKeyLocked(int key) { return (GetKeyState(key) & 1) != 0; }
  public static bool SetWindowState(long handle,int state) { var h=new IntPtr(handle); if(!IsWindow(h))return false; ShowWindowAsync(h,state); return true; }
  public static bool CloseWindow(long handle) { var h=new IntPtr(handle); return IsWindow(h) && PostMessage(h,0x0112,new IntPtr(0xF060),IntPtr.Zero); }
  public const uint KEYUP = 2;
  public static void ReleaseRemoteModifiers() {
    keybd_event(0x5B,0,KEYUP,UIntPtr.Zero); keybd_event(0x5C,0,KEYUP,UIntPtr.Zero);
    keybd_event(0x11,0,KEYUP,UIntPtr.Zero); keybd_event(0x10,0,KEYUP,UIntPtr.Zero);
    keybd_event(0x12,0,KEYUP,UIntPtr.Zero);
  }
  static void WindowKey(IntPtr target,byte key,bool down,bool system=false) {
    uint scan=MapVirtualKey(key,0); long data=1L|((long)scan<<16);
    if(system)data|=1L<<29;
    if(!down)data|=0xC0000000L;
    uint message=system?(down?0x0104u:0x0105u):(down?0x0100u:0x0101u);
    SendMessage(target,message,new IntPtr(key),new IntPtr(data));
  }
  public static bool SendWindowKey(long handle,byte key,bool ctrl=false,bool shift=false,bool alt=false) {
    var h=new IntPtr(handle); if(!IsWindow(h))return false;
    uint pid; uint targetThread=GetWindowThreadProcessId(h,out pid),current=GetCurrentThreadId(); bool attached=false;
    try {
      if(targetThread!=0&&targetThread!=current)attached=AttachThreadInput(current,targetThread,true);
      var target=GetFocus(); if(target==IntPtr.Zero)target=h;
      if(ctrl)WindowKey(target,0x11,true); if(shift)WindowKey(target,0x10,true); if(alt)WindowKey(target,0x12,true,true);
      try { WindowKey(target,key,true,alt); WindowKey(target,key,false,alt); }
      finally { if(alt)WindowKey(target,0x12,false,true); if(shift)WindowKey(target,0x10,false); if(ctrl)WindowKey(target,0x11,false); }
      return true;
    } finally { if(attached)AttachThreadInput(current,targetThread,false); }
  }
  public static bool SendBrowserKey(long handle,byte key,bool ctrl=false,bool shift=false,bool alt=false) {
    ReleaseRemoteModifiers();
    var inputs=new List<Input>();
    Action<byte,bool> addKey=(vk,up)=>inputs.Add(new Input{type=1,value=new InputUnion{keyboard=new KeyboardInput{virtualKey=vk,flags=(up?KEYUP:0u)|(IsExtended(vk)?1u:0u)}}});
    addKey(0x5B,true); addKey(0x5C,true);
    if(ctrl)addKey(0x11,false); if(shift)addKey(0x10,false); if(alt)addKey(0x12,false);
    addKey(key,false); addKey(key,true);
    if(alt)addKey(0x12,true); if(shift)addKey(0x10,true); if(ctrl)addKey(0x11,true);
    addKey(0x5B,true); addKey(0x5C,true);
    return SendInput((uint)inputs.Count,inputs.ToArray(),Marshal.SizeOf(typeof(Input)))==inputs.Count;
  }
  public static bool ActivatePlayer(string name) {
    string[] names=name=="mpc-hc64"?new string[]{"mpc-hc","mpc-hc64"}:name=="potplayer"?new string[]{"PotPlayerMini64","PotPlayerMini","PotPlayer"}:new string[]{name};
    foreach(var item in names) foreach(var p in System.Diagnostics.Process.GetProcessesByName(item)) {
      try { if(p.MainWindowHandle != IntPtr.Zero) { ShowWindowAsync(p.MainWindowHandle,9); return SetForegroundWindow(p.MainWindowHandle); } } catch {}
    }
    return false;
  }
  // Arrow, Home/End, PgUp/PgDn, Ins/Del, Win, Menu and right Ctrl/Alt are "extended" keys.
  // Without KEYEVENTF_EXTENDEDKEY some apps read them as their numeric-keypad twins.
  static bool IsExtended(byte k) { return (k>=0x21&&k<=0x28)||k==0x2D||k==0x2E||k==0x5B||k==0x5C||k==0x5D||k==0x6F||k==0xA3||k==0xA5; }
  public static void Key(byte key) { uint ext=IsExtended(key)?1u:0u; keybd_event(key,0,ext,UIntPtr.Zero); keybd_event(key,0,ext|KEYUP,UIntPtr.Zero); }
  public static void Tap(byte key, bool ctrl=false, bool shift=false, bool alt=false) {
    if (ctrl) keybd_event(0x11,0,0,UIntPtr.Zero);
    if (shift) keybd_event(0x10,0,0,UIntPtr.Zero);
    if (alt) keybd_event(0x12,0,0,UIntPtr.Zero);
    Key(key);
    if (alt) keybd_event(0x12,0,KEYUP,UIntPtr.Zero);
    if (shift) keybd_event(0x10,0,KEYUP,UIntPtr.Zero);
    if (ctrl) keybd_event(0x11,0,KEYUP,UIntPtr.Zero);
  }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator { void EnumAudioEndpoints(); void GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice { void Activate(ref Guid iid,int clsctx,IntPtr activationParams,[MarshalAs(UnmanagedType.IUnknown)] out object obj); }
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
 void RegisterControlChangeNotify(IntPtr p); void UnregisterControlChangeNotify(IntPtr p); void GetChannelCount(out uint count);
 void SetMasterVolumeLevel(float level,Guid ctx); void SetMasterVolumeLevelScalar(float level,Guid ctx); void GetMasterVolumeLevel(out float level); void GetMasterVolumeLevelScalar(out float level);
 void SetChannelVolumeLevel(uint channel,float level,Guid ctx); void SetChannelVolumeLevelScalar(uint channel,float level,Guid ctx); void GetChannelVolumeLevel(uint channel,out float level); void GetChannelVolumeLevelScalar(uint channel,out float level);
 void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute,Guid ctx); void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager { void GetAudioSessionControl(); void GetSimpleAudioVolume(); }
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 : IAudioSessionManager { new void GetAudioSessionControl(); new void GetSimpleAudioVolume(); void GetSessionEnumerator(out IAudioSessionEnumerator e); }
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator { void GetCount(out int count); void GetSession(int index,out IAudioSessionControl control); }
[ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl { void GetState(out int state); void GetDisplayName(); void SetDisplayName(); void GetIconPath(); void SetIconPath(); void GetGroupingParam(); void SetGroupingParam(); void RegisterAudioSessionNotification(); void UnregisterAudioSessionNotification(); }
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 : IAudioSessionControl { new void GetState(out int state); new void GetDisplayName(); new void SetDisplayName(); new void GetIconPath(); new void SetIconPath(); new void GetGroupingParam(); new void SetGroupingParam(); new void RegisterAudioSessionNotification(); new void UnregisterAudioSessionNotification(); void GetSessionIdentifier(); void GetSessionInstanceIdentifier(); void GetProcessId(out uint pid); void IsSystemSoundsSession(); void SetDuckingPreference(); }
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISimpleAudioVolume { void SetMasterVolume(float level,Guid ctx); void GetMasterVolume(out float level); void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute,Guid ctx); void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute); }

public class PlayerAudio { public string name; public string process; public float volume; public bool muted; }
public static class AudioControl {
 static string Canonical(string n) { n=n.ToLowerInvariant(); if(n=="mpc-hc")return "mpc-hc64"; if(n=="potplayermini"||n=="potplayermini64")return "potplayer"; return n; }
 static IMMDevice Device() { var en=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; en.GetDefaultAudioEndpoint(0,0,out d); return d; }
 public static IAudioEndpointVolume Endpoint() { var d=Device(); object o; var id=typeof(IAudioEndpointVolume).GUID; d.Activate(ref id,23,IntPtr.Zero,out o); return (IAudioEndpointVolume)o; }
 public static float GetSystemVolume() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; }
 public static bool GetSystemMuted() { bool m; Endpoint().GetMute(out m); return m; }
 public static void SetSystemVolume(float v) { Endpoint().SetMasterVolumeLevelScalar(v,Guid.Empty); }
 public static void ToggleSystemMute() { var ep=Endpoint(); bool m; ep.GetMute(out m); ep.SetMute(!m,Guid.Empty); }
 static IAudioSessionEnumerator Sessions() { var d=Device(); object o; var id=typeof(IAudioSessionManager2).GUID; d.Activate(ref id,23,IntPtr.Zero,out o); IAudioSessionEnumerator e; ((IAudioSessionManager2)o).GetSessionEnumerator(out e); return e; }
 public static List<PlayerAudio> GetPlayers() {
  var result=new List<PlayerAudio>(); var e=Sessions(); int count; e.GetCount(out count);
  for(int i=0;i<count;i++){ IAudioSessionControl c; e.GetSession(i,out c); try { var c2=(IAudioSessionControl2)c; uint pid; c2.GetProcessId(out pid); var p=System.Diagnostics.Process.GetProcessById((int)pid); var n=p.ProcessName.ToLowerInvariant(); if(n!="vlc"&&n!="musicbee"&&n!="potplayer"&&n!="potplayermini"&&n!="potplayermini64"&&n!="mpc-hc"&&n!="mpc-hc64"&&n!="wmplayer") continue; var v=(ISimpleAudioVolume)c; float vol; bool mute; v.GetMasterVolume(out vol); v.GetMute(out mute); result.Add(new PlayerAudio{name=Canonical(n),process=n,volume=vol,muted=mute}); } catch {} }
  return result;
 }
 public static bool SetPlayer(string name,float? volume,bool? mute) {
  bool found=false; var e=Sessions(); int count; e.GetCount(out count);
  for(int i=0;i<count;i++){ IAudioSessionControl c; e.GetSession(i,out c); try { var c2=(IAudioSessionControl2)c; uint pid; c2.GetProcessId(out pid); var p=System.Diagnostics.Process.GetProcessById((int)pid); if(Canonical(p.ProcessName)==Canonical(name)){ var v=(ISimpleAudioVolume)c; if(volume.HasValue)v.SetMasterVolume(volume.Value,Guid.Empty); if(mute.HasValue)v.SetMute(mute.Value,Guid.Empty); found=true; } } catch {} }
  return found;
 }
}
'@
if (-not ('AudioControl' -as [type])) { Add-Type -TypeDefinition $native -Language CSharp }

function Get-PlayerProcesses([string]$name) {
  switch -Regex ($name) {
    '^mpc-hc' { @('mpc-hc','mpc-hc64') }
    '^potplayer$' { @('PotPlayerMini64','PotPlayerMini','PotPlayer') }
    default { @($name) }
  }
}
function Get-PlayerExecutable([string]$name) {
  foreach($procName in (Get-PlayerProcesses $name)) {
    $proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
    if($proc) { try { if($proc.Path -and (Test-Path -LiteralPath $proc.Path)){ return $proc.Path } } catch {} }
  }
  $exeNames = switch -Regex ($name) {
    '^vlc$' { @('vlc.exe') }
    '^musicbee$' { @('MusicBee.exe') }
    '^potplayer$' { @('PotPlayerMini64.exe','PotPlayerMini.exe','PotPlayer.exe') }
    '^mpc-hc' { @('mpc-hc64.exe','mpc-hc.exe') }
    default { @('wmplayer.exe') }
  }
  foreach($exe in $exeNames) { $cmd=Get-Command $exe -ErrorAction SilentlyContinue | Select-Object -First 1; if($cmd){return $cmd.Source} }
  $base=@($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA) | Where-Object { $_ }
  $relative = switch -Regex ($name) {
    '^vlc$' { @('VideoLAN\VLC\vlc.exe') }
    '^musicbee$' { @('MusicBee\MusicBee.exe') }
    '^potplayer$' { @('DAUM\PotPlayer\PotPlayerMini64.exe','DAUM\PotPlayer\PotPlayerMini.exe') }
    '^mpc-hc' { @('MPC-HC\mpc-hc64.exe','K-Lite Codec Pack\MPC-HC64\mpc-hc64.exe','K-Lite Codec Pack\MPC-HC\mpc-hc.exe') }
    default { @('Windows Media Player\wmplayer.exe') }
  }
  foreach($dir in $base) { foreach($rel in $relative) { $candidate=Join-Path $dir $rel; if(Test-Path -LiteralPath $candidate){return $candidate} } }
  if($name -match '^mpc-hc') {
    foreach($dir in @($env:ProgramFiles,${env:ProgramFiles(x86)}) | Where-Object { $_ }) {
      $klite=Join-Path $dir 'K-Lite Codec Pack'
      if(Test-Path -LiteralPath $klite) {
        $found=Get-ChildItem -LiteralPath $klite -Filter 'mpc-hc*.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object @{Expression={if($_.Name -eq 'mpc-hc64.exe'){0}else{1}}} | Select-Object -First 1
        if($found){return $found.FullName}
      }
    }
  }
  throw "Could not find $name. Install the player or add its program folder to PATH."
}
function Get-BrowserExecutable([string]$browser) {
  $exeName=switch($browser){
    'edge' {'msedge.exe'}
    'chrome' {'chrome.exe'}
    'firefox' {'firefox.exe'}
    'brave' {'brave.exe'}
    default {throw "Unknown browser: $browser"}
  }
  $relative=switch($browser){
    'edge' {'Microsoft\Edge\Application\msedge.exe'}
    'chrome' {'Google\Chrome\Application\chrome.exe'}
    'firefox' {'Mozilla Firefox\firefox.exe'}
    'brave' {'BraveSoftware\Brave-Browser\Application\brave.exe'}
  }
  foreach($root in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)|Where-Object{$_}){$candidate=Join-Path $root $relative;if(Test-Path -LiteralPath $candidate){return $candidate}}
  foreach($hive in @('HKEY_CURRENT_USER','HKEY_LOCAL_MACHINE')) {
    foreach($branch in @('Software\Microsoft\Windows\CurrentVersion\App Paths','Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')) {
      try{$key=Get-Item -LiteralPath "Registry::$hive\$branch\$exeName" -ErrorAction Stop;$candidate=[string]$key.GetValue('');if($candidate -and (Test-Path -LiteralPath $candidate)){return $candidate}}catch{}
    }
  }
  $command=Get-Command $exeName -ErrorAction SilentlyContinue|Select-Object -First 1
  if($command){return $command.Source}
  throw "$browser browser was not found on this PC. Install it or choose another browser."
}
function Get-CurrentWindow {
  $handle=[WinAudio]::ForegroundHandle()
  [pscustomobject]@{handle=$handle.ToInt64();title=[WinAudio]::WindowTitle($handle.ToInt64())}
}
function Wait-OpenedWindow([long]$previousHandle,[string]$previousTitle,$launchedProcess) {
  for($i=0;$i -lt 180;$i++) {
    $handle=[WinAudio]::ForegroundHandle()
    if($handle -ne [IntPtr]::Zero) {
      $number=$handle.ToInt64();$title=[WinAudio]::WindowTitle($number);$owner=[WinAudio]::WindowProcessId($number)
      $process=if($owner){Get-Process -Id $owner -ErrorAction SilentlyContinue}else{$null}
      if($title -and $process -and $process.ProcessName -notmatch '^(powershell|pwsh|node)$' -and ($number -ne $previousHandle -or $title -ne $previousTitle)){return $number}
      if($launchedProcess) { try{$launchedProcess.Refresh();if($launchedProcess.MainWindowHandle -ne [IntPtr]::Zero){return $launchedProcess.MainWindowHandle.ToInt64()}}catch{} }
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'The app is still opening, but its window was not detected. Try the file again after it finishes opening.'
}

if ($Action -eq 'state') {
  $vol = [AudioControl]::GetSystemVolume(); $mute = [AudioControl]::GetSystemMuted()
  # Probing four browsers is the slowest part of a status check, so the server
  # asks for it only now and then and reuses the last answer in between.
  $availableBrowsers=$null
  if($payload.detectBrowsers){
    $availableBrowsers=@('default')
    foreach($browser in @('edge','chrome','firefox','brave')){try{$null=Get-BrowserExecutable $browser;$availableBrowsers+=$browser}catch{}}
  }
  $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('vlc','MusicBee','PotPlayer','PotPlayerMini','PotPlayerMini64','mpc-hc','mpc-hc64','wmplayer') } | Select-Object -ExpandProperty ProcessName -Unique
  $running = @($procs | ForEach-Object { switch -Regex ($_.ToLowerInvariant()) { '^mpc-hc$' { 'mpc-hc64' } '^potplayermini' { 'potplayer' } default { $_.ToLowerInvariant() } } })
  $active = @([AudioControl]::GetPlayers() | ForEach-Object { [pscustomobject]@{name=$_.name;volume=[math]::Round($_.volume*100);muted=$_.muted} })
  $foreground=Get-CurrentWindow
  $foregroundPid=[WinAudio]::WindowProcessId([long]$foreground.handle)
  $foregroundProcess=if($foregroundPid){Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue}else{$null}
  $foregroundName=if($foregroundProcess){$foregroundProcess.ProcessName}else{''}
  $foregroundWindow=if($foreground.title -and $foregroundName -notmatch '^(powershell|pwsh|node|conhost|explorer|SearchHost|ShellExperienceHost|StartMenuExperienceHost|TextInputHost|LockApp)$'){[long]$foreground.handle}else{0}
  $foregroundExplorerWindow=if($foreground.title -and $foregroundName -eq 'explorer'){[long]$foreground.handle}else{0}
  $targetOwner=[WinAudio]::WindowProcessId([long]$payload.targetWindow)
  $targetProcess=if($targetOwner){Get-Process -Id $targetOwner -ErrorAction SilentlyContinue}else{$null}
  $targetWindowExists=[WinAudio]::WindowExists([long]$payload.targetWindow) -and $targetProcess -and $targetProcess.ProcessName -notmatch '^(powershell|pwsh|node|conhost|explorer|SearchHost|ShellExperienceHost|StartMenuExperienceHost|TextInputHost|LockApp)$'
  $explorerOwner=[WinAudio]::WindowProcessId([long]$payload.explorerWindow)
  $explorerProcess=if($explorerOwner){Get-Process -Id $explorerOwner -ErrorAction SilentlyContinue}else{$null}
  $explorerTargetWindowExists=[WinAudio]::WindowExists([long]$payload.explorerWindow) -and $explorerProcess -and $explorerProcess.ProcessName -eq 'explorer'
  [pscustomobject]@{systemVolume=[math]::Round($vol*100);systemMuted=$mute;players=$active;running=$running;browsers=$availableBrowsers;foregroundWindow=$foregroundWindow;foregroundExplorerWindow=$foregroundExplorerWindow;capsLock=[WinAudio]::IsKeyLocked(0x14);numLock=[WinAudio]::IsKeyLocked(0x90);scrollLock=[WinAudio]::IsKeyLocked(0x91);targetWindowExists=[bool]$targetWindowExists;explorerTargetWindowExists=[bool]$explorerTargetWindowExists} | ConvertTo-Json -Compress -Depth 4
  exit 0
}

function Send-PlayerSeek([string]$name,[int]$key,[int]$repeat) {
  if(!$name){throw 'Choose a player first.'}
  if(-not [WinAudio]::ActivatePlayer($name)){throw 'Could not focus the selected player window.'}
  Start-Sleep -Milliseconds 100
  $shift=($name -eq 'vlc')
  for($i=0;$i -lt $repeat;$i++){[WinAudio]::Tap([byte]$key,$false,$shift);if($i -lt ($repeat-1)){Start-Sleep -Milliseconds 90}}
}

if ($Action -eq 'control') {
  $a=[string]$payload.action; $player=[string]$payload.player; $value=[math]::Max(0,[math]::Min(100,[double]$payload.value))/100
  switch ($a) {
    'browserOpen' {
      $browser=[string]$payload.browser; $url=[string]$payload.url
      if($url){$uri=$null;if(-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('http','https')){throw 'Enter a valid http or https address.'}}
      $before=Get-CurrentWindow
      if($browser -eq 'default'){$target=if($url){$url}else{'https://www.google.com'};$launched=Start-Process -FilePath $target -PassThru}
      else{$exe=Get-BrowserExecutable $browser;$target=if($url){$url}else{'about:blank'};$quoted='"'+$target.Replace('"','\"')+'"';$launched=Start-Process -FilePath $exe -ArgumentList $quoted -PassThru}
      $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched
      [Console]::Out.Write($handle)
      exit 0
    }
    { $_ -in @('browserBack','browserForward','browserReload','browserHome','browserArrowUp','browserArrowDown','browserArrowLeft','browserArrowRight','browserScrollUp','browserScrollDown','browserTab','browserShiftTab','browserEnter','browserEscape','browserCloseTab') } {
      $handle=[long]$payload.targetWindow
      [WinAudio]::ReleaseRemoteModifiers()
      if(-not [WinAudio]::ActivateWindow($handle)){throw 'Open a browser from the Browser tab first.'}
      Start-Sleep -Milliseconds 80
      switch($a){
        'browserBack' {if(-not [WinAudio]::SendBrowserKey($handle,0x25,$false,$false,$true)){throw 'Could not send input to the browser.'}}
        'browserForward' {if(-not [WinAudio]::SendBrowserKey($handle,0x27,$false,$false,$true)){throw 'Could not send input to the browser.'}}
        'browserReload' {if(-not [WinAudio]::SendBrowserKey($handle,0x52,$true)){throw 'Could not send input to the browser.'}}
        'browserHome' {if(-not [WinAudio]::SendBrowserKey($handle,0x24,$false,$false,$true)){throw 'Could not send input to the browser.'}}
        'browserArrowUp' {if(-not [WinAudio]::SendBrowserKey($handle,0x26)){throw 'Could not send input to the browser.'}}
        'browserArrowDown' {if(-not [WinAudio]::SendBrowserKey($handle,0x28)){throw 'Could not send input to the browser.'}}
        'browserArrowLeft' {if(-not [WinAudio]::SendBrowserKey($handle,0x25)){throw 'Could not send input to the browser.'}}
        'browserArrowRight' {if(-not [WinAudio]::SendBrowserKey($handle,0x27)){throw 'Could not send input to the browser.'}}
        'browserScrollUp' {if(-not [WinAudio]::SendBrowserKey($handle,0x21)){throw 'Could not send input to the browser.'}}
        'browserScrollDown' {if(-not [WinAudio]::SendBrowserKey($handle,0x22)){throw 'Could not send input to the browser.'}}
        'browserTab' {if(-not [WinAudio]::SendBrowserKey($handle,0x09)){throw 'Could not send input to the browser.'}}
        'browserShiftTab' {if(-not [WinAudio]::SendBrowserKey($handle,0x09,$false,$true)){throw 'Could not send input to the browser.'}}
        'browserEnter' {if(-not [WinAudio]::SendBrowserKey($handle,0x0D)){throw 'Could not send input to the browser.'}}
        'browserEscape' {if(-not [WinAudio]::SendBrowserKey($handle,0x1B)){throw 'Could not send input to the browser.'}}
        'browserCloseTab' {if(-not [WinAudio]::SendBrowserKey($handle,0x57,$true)){throw 'Could not send input to the browser.'}}
      }
    }
    { $_ -in @('browserMinimize','browserMaximize','browserRestore') } {
      $handle=[long]$payload.targetWindow
      $state=switch($a){'browserMinimize'{6};'browserMaximize'{3};default{9}}
      if(-not [WinAudio]::SetWindowState($handle,$state)){throw 'Open a browser from the Browser tab first.'}
    }
    'browserFullscreen' {
      $handle=[long]$payload.targetWindow
      if(-not [WinAudio]::ActivateWindow($handle)){throw 'Open a browser from the Browser tab first.'}
      [WinAudio]::SendWindowKey($handle,0x7A)
    }
    'browserClose' {if(-not [WinAudio]::CloseWindow([long]$payload.targetWindow)){throw 'Open a browser from the Browser tab first.'}}
    'keyboardPress' {
      $key=[string]$payload.key
      $vk=$null
      if($key -match '^[A-Z]$'){$vk=[byte][char]$key}
      elseif($key -match '^[0-9]$'){$vk=[byte][char]$key}
      elseif($key -match '^F([1-9]|1[0-9]|2[0-4])$'){$vk=0x70+[int]$Matches[1]-1}
      elseif($key -match '^NUM([0-9])$'){$vk=0x60+[int]$Matches[1]}
      else{$vk=@{SPACE=0x20;ENTER=0x0D;TAB=0x09;ESCAPE=0x1B;BACKSPACE=0x08;DELETE=0x2E;INSERT=0x2D;HOME=0x24;END=0x23;PAGEUP=0x21;PAGEDOWN=0x22;UP=0x26;DOWN=0x28;LEFT=0x25;RIGHT=0x27;CAPSLOCK=0x14;NUMLOCK=0x90;SCROLLLOCK=0x91;PRINTSCREEN=0x2C;PAUSE=0x13;EQUALS=0xBB;MINUS=0xBD;COMMA=0xBC;PERIOD=0xBE;SLASH=0xBF;BACKSLASH=0xDC;SEMICOLON=0xBA;QUOTE=0xDE;LBRACKET=0xDB;RBRACKET=0xDD;BACKQUOTE=0xC0;NUMADD=0x6B;NUMSUBTRACT=0x6D;NUMMULTIPLY=0x6A;NUMDIVIDE=0x6F;NUMDECIMAL=0x6E;NUMENTER=0x0D;WIN=0x5B;ALTGR=0xA5;MENU=0x5D}[$key]}
      if($null -eq $vk){throw 'Unsupported keyboard key.'}
      $mods=$payload.modifiers
      if($mods.win){[WinAudio]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)}
      [WinAudio]::Tap([byte]$vk,[bool]$mods.ctrl,[bool]$mods.shift,[bool]$mods.alt)
      if($mods.win){[WinAudio]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)}
    }
    'playPause' { [WinAudio]::Key(0xB3) }
    'play' { [WinAudio]::Key(0xB3) }
    'pause' { [WinAudio]::Key(0xB3) }
    'next' { [WinAudio]::Key(0xB0) }
    'previous' { [WinAudio]::Key(0xB1) }
    'seekSmallForward' { Send-PlayerSeek $player 0x27 1 }
    'seekSmallBackward' { Send-PlayerSeek $player 0x25 1 }
    'seekLargeForward' { Send-PlayerSeek $player 0x27 6 }
    'seekLargeBackward' { Send-PlayerSeek $player 0x25 6 }
    'toggleFullscreen' {
      if(!$player){throw 'Choose a player first.'}
      if(-not [WinAudio]::ActivatePlayer($player)){throw 'Could not focus the selected player window.'}
      Start-Sleep -Milliseconds 100
      switch -Regex ($player) {
        '^vlc$' { [WinAudio]::Tap(0x46) }
        '^potplayer$' { [WinAudio]::Tap(0x0D) }
        '^mpc-hc' { [WinAudio]::Tap(0x0D,$false,$false,$true) }
        default { throw 'Full screen toggle is supported for VLC, PotPlayer, and MPC-HC.' }
      }
    }
    { $_ -in @('defaultScrollUp','defaultScrollDown','defaultPrevious','defaultNext','defaultArrowUp','defaultArrowDown','defaultArrowLeft','defaultArrowRight','defaultHome','defaultEnd','defaultFullscreen') } {
      $handle=[long]$payload.targetWindow
      if(-not [WinAudio]::ActivateWindow($handle)){throw 'Open a file in its default app first.'}
      Start-Sleep -Milliseconds 80
      switch ($a) {
        'defaultScrollUp' { [WinAudio]::Tap(0x21) }
        'defaultScrollDown' { [WinAudio]::Tap(0x22) }
        'defaultPrevious' { [WinAudio]::Tap(0x25) }
        'defaultNext' { [WinAudio]::Tap(0x27) }
        'defaultArrowUp' { [WinAudio]::Tap(0x26) }
        'defaultArrowDown' { [WinAudio]::Tap(0x28) }
        'defaultArrowLeft' { [WinAudio]::Tap(0x25) }
        'defaultArrowRight' { [WinAudio]::Tap(0x27) }
        'defaultHome' { [WinAudio]::Tap(0x24) }
        'defaultEnd' { [WinAudio]::Tap(0x23) }
        'defaultFullscreen' {
          $owner=[WinAudio]::WindowProcessId($handle)
          $app=if($owner){Get-Process -Id $owner -ErrorAction SilentlyContinue}else{$null}
          if($app -and $app.ProcessName -eq 'WINWORD'){[WinAudio]::Tap(0x57,$false,$false,$true);Start-Sleep -Milliseconds 80;[WinAudio]::Tap(0x46)}else{[WinAudio]::Tap(0x7A)}
        }
      }
    }
    { $_ -in @('defaultMinimize','defaultMaximize','defaultRestore') } {
      $handle=[long]$payload.targetWindow
      $state=switch($a){'defaultMinimize'{6};'defaultMaximize'{3};default{9}}
      if(-not [WinAudio]::SetWindowState($handle,$state)){throw 'Open a file in its default app first.'}
    }
    'defaultClose' { if(-not [WinAudio]::CloseWindow([long]$payload.targetWindow)){throw 'Open a file in its default app first.'} }
    { $_ -in @('explorerUp','explorerDown','explorerLeft','explorerRight','explorerTab','explorerShiftTab','explorerEnter','explorerClose') } {
      $handle=[long]$payload.targetWindow
      $foreground=Get-CurrentWindow
      $foregroundPid=[WinAudio]::WindowProcessId([long]$foreground.handle)
      $foregroundProcess=if($foregroundPid){Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue}else{$null}
      if($foreground.title -and $foregroundProcess -and $foregroundProcess.ProcessName -eq 'explorer'){$handle=[long]$foreground.handle}
      if($handle) {
        $targetOwner=[WinAudio]::WindowProcessId($handle)
        $targetProcess=if($targetOwner){Get-Process -Id $targetOwner -ErrorAction SilentlyContinue}else{$null}
        if(-not $targetProcess -or $targetProcess.ProcessName -ne 'explorer'){$handle=0}
      }
      if($a -eq 'explorerClose') {
        if($handle -and [WinAudio]::CloseWindow($handle)) {
          for($wait=0;$wait -lt 30;$wait++){if(-not [WinAudio]::WindowExists($handle)){exit 0};Start-Sleep -Milliseconds 50}
        }
        foreach($windowProcess in (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
          $candidate=[long]$windowProcess.MainWindowHandle
          if($candidate -and [WinAudio]::CloseWindow($candidate)) {
            for($wait=0;$wait -lt 30;$wait++){if(-not [WinAudio]::WindowExists($candidate)){exit 0};Start-Sleep -Milliseconds 50}
          }
        }
        throw 'Windows Explorer is not open or could not be closed.'
      }
      $activated=[WinAudio]::ActivateWindow($handle)
      if(-not $activated -and [long][WinAudio]::ForegroundHandle() -ne $handle) {
        foreach($windowProcess in (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
          $candidate=[long]$windowProcess.MainWindowHandle
          if($candidate -and [WinAudio]::ActivateWindow($candidate)){$handle=$candidate;$activated=$true;break}
        }
      }
      if(-not $activated){throw 'Windows Explorer is not open or could not be focused. Open a folder in Explorer first.'}
      Start-Sleep -Milliseconds 80
      switch ($a) {
        'explorerUp' { [WinAudio]::Tap(0x26) }
        'explorerDown' { [WinAudio]::Tap(0x28) }
        'explorerLeft' { [WinAudio]::Tap(0x25) }
        'explorerRight' { [WinAudio]::Tap(0x27) }
        'explorerTab' { [WinAudio]::Tap(0x09) }
        'explorerShiftTab' { [WinAudio]::Tap(0x09,$false,$true) }
        'explorerEnter' { [WinAudio]::Tap(0x0D) }
      }
    }
    'systemVolume' { [AudioControl]::SetSystemVolume([single]$value) }
    'systemMute' { [AudioControl]::ToggleSystemMute() }
    'playerVolume' { if(!$player){throw 'Choose a player first.'}; if(-not [AudioControl]::SetPlayer($player,[Nullable[single]]([single]$value),$null)){throw 'That player has no active audio session.'} }
    'playerMute' { if(!$player){throw 'Choose a player first.'}; $all=[AudioControl]::GetPlayers() | Where-Object { $_.name -eq $player }; if(!$all){throw 'That player has no active audio session.'}; $mute = -not [bool]$all[0].muted; [AudioControl]::SetPlayer($player,$null,[Nullable[bool]]$mute) | Out-Null }
    'openApp' {
      $appId=[string]$payload.appId
      if(!$appId){throw 'Choose an app first.'}
      Start-Process -FilePath ('shell:AppsFolder\'+$appId) | Out-Null
    }
    'openPlayer' { $exe=Get-PlayerExecutable $player; Start-Process -FilePath $exe | Out-Null }
    'closePlayer' { $found=$false; foreach($name in (Get-PlayerProcesses $player)){ foreach($p in (Get-Process -Name $name -ErrorAction SilentlyContinue)){ $found=$true; try { if($p.CloseMainWindow()){if(-not $p.WaitForExit(1800)){ $p.Kill() }}else{$p.Kill()} } catch { try{$p.Kill()}catch{} } } }; if(!$found){throw 'That player is not running.'} }
    'openFile' {
      $file=[string]$payload.path
      if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'That file is not available.'}
      if(@($payload.mediaExtensions | ForEach-Object { $_.ToLowerInvariant() }) -notcontains ([IO.Path]::GetExtension($file).ToLowerInvariant())){throw 'That file type is not supported.'}
      $exe=Get-PlayerExecutable $player
      $fileArgument='"'+$file.Replace('"','\"')+'"'
      if($player -eq 'vlc'){$fileArgument='--started-from-file '+$fileArgument}
      Start-Process -FilePath $exe -ArgumentList $fileArgument | Out-Null
    }
    'openDefaultFile' {
      $file=[string]$payload.path
      if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'That file is not available.'}
      if(@($payload.mediaExtensions | ForEach-Object { $_.ToLowerInvariant() }) -contains ([IO.Path]::GetExtension($file).ToLowerInvariant())){throw 'Audio and video files should be opened with the selected player.'}
      $before=Get-CurrentWindow
      $launched=Start-Process -FilePath $file -PassThru
      $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched
      [Console]::Out.Write($handle)
      exit 0
    }
    'openFolder' { $folder=[string]$payload.path; if(!(Test-Path -LiteralPath $folder -PathType Container)){throw 'That folder is not available.'}; $before=Get-CurrentWindow; $launched=Start-Process -FilePath explorer.exe -ArgumentList ('"'+$folder.Replace('"','\"')+'"') -PassThru; $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched; [Console]::Out.Write($handle); exit 0 }
    'seekForward' { Send-PlayerSeek $player 0x27 1 }
    'seekBackward' { Send-PlayerSeek $player 0x25 1 }
  }
  [Console]::Out.Write('{"ok":true}')
}
