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
      try { if(p.MainWindowHandle != IntPtr.Zero && ActivateWindow(p.MainWindowHandle.ToInt64())) return true; } catch {}
    }
    return false;
  }
  // MPC-HC (the K-Lite player) accepts WM_COMMAND without having focus: 907 vol up, 908 vol down, 909 mute.
  public static bool PostPlayerCommand(string name,int command) {
    string[] names=name=="mpc-hc64"?new string[]{"mpc-hc64","mpc-hc"}:new string[]{name};
    foreach(var item in names) foreach(var p in System.Diagnostics.Process.GetProcessesByName(item)) {
      try { if(p.MainWindowHandle != IntPtr.Zero) return PostMessage(p.MainWindowHandle,0x0111,new IntPtr(command),IntPtr.Zero); } catch {}
    }
    return false;
  }
  public static bool PostPlayerAppCommand(string name,int command) {
    string[] names=name=="mpc-hc64"?new string[]{"mpc-hc64","mpc-hc"}:name=="potplayer"?new string[]{"PotPlayerMini64","PotPlayerMini","PotPlayer"}:new string[]{name};
    foreach(var item in names) foreach(var p in System.Diagnostics.Process.GetProcessesByName(item)) {
      try { if(p.MainWindowHandle != IntPtr.Zero) return PostMessage(p.MainWindowHandle,0x0319,p.MainWindowHandle,new IntPtr(command<<16)); } catch {}
    }
    return false;
  }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token,int infoClass,out int info,int length,out int returned);
  // True when the process runs as administrator. Windows blocks simulated input into such windows
  // unless RemoteDeck is elevated too.
  public static bool IsProcessElevated(uint pid) {
    IntPtr process=IntPtr.Zero, token=IntPtr.Zero;
    try {
      process=OpenProcess(0x1000,false,pid); if(process==IntPtr.Zero) return false;
      if(!OpenProcessToken(process,0x0008,out token)) return false;
      int elevated,returned; return GetTokenInformation(token,20,out elevated,4,out returned) && elevated!=0;
    } catch { return false; }
    finally { if(token!=IntPtr.Zero) CloseHandle(token); if(process!=IntPtr.Zero) CloseHandle(process); }
  }
  public static bool SelfElevated() { return IsProcessElevated((uint)System.Diagnostics.Process.GetCurrentProcess().Id); }
  [DllImport("user32.dll")] static extern bool LockWorkStation();
  [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate,bool force,bool disableWakeEvent);
  public static bool Lock() { return LockWorkStation(); }
  public static bool Sleep() { return SetSuspendState(false,false,false); }
  public static void DisplayOff() { PostMessage(new IntPtr(0xFFFF),0x0112,new IntPtr(0xF170),new IntPtr(2)); }
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
public interface IMMDeviceEnumerator { void EnumAudioEndpoints(int dataFlow,int stateMask,out IMMDeviceCollection devices); void GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice device); }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection { void GetCount(out uint count); void Item(uint index,out IMMDevice device); }
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
 static IAudioSessionEnumerator SessionsOf(IMMDevice d) { object o; var id=typeof(IAudioSessionManager2).GUID; d.Activate(ref id,23,IntPtr.Zero,out o); IAudioSessionEnumerator e; ((IAudioSessionManager2)o).GetSessionEnumerator(out e); return e; }
 // A player can send its audio to any output, not only the Windows default, so every active output is searched.
 static List<IAudioSessionEnumerator> AllSessions() {
  var list=new List<IAudioSessionEnumerator>();
  try {
   var en=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDeviceCollection col; en.EnumAudioEndpoints(0,1,out col); uint n; col.GetCount(out n);
   for(uint i=0;i<n;i++) { try { IMMDevice d; col.Item(i,out d); list.Add(SessionsOf(d)); } catch {} }
  } catch {}
  if(list.Count==0) { try { list.Add(SessionsOf(Device())); } catch {} }
  return list;
 }
 static string ProcessOf(IAudioSessionControl c) {
  try { var c2=(IAudioSessionControl2)c; uint pid; c2.GetProcessId(out pid); if(pid==0) return null; return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { return null; }
 }
 static bool IsPlayer(string n) { return n=="vlc"||n=="musicbee"||n=="potplayer"||n=="potplayermini"||n=="potplayermini64"||n=="mpc-hc"||n=="mpc-hc64"||n=="wmplayer"; }
 public static List<PlayerAudio> GetPlayers() {
  var result=new Dictionary<string,PlayerAudio>();
  foreach(var e in AllSessions()) {
   int count; e.GetCount(out count);
   for(int i=0;i<count;i++) {
    try {
     IAudioSessionControl c; e.GetSession(i,out c); var n=ProcessOf(c); if(n==null||!IsPlayer(n)) continue;
     var v=(ISimpleAudioVolume)c; float vol; bool mute; v.GetMasterVolume(out vol); v.GetMute(out mute);
     var key=Canonical(n); PlayerAudio existing;
     if(result.TryGetValue(key,out existing)) { if(vol>existing.volume) existing.volume=vol; existing.muted=existing.muted&&mute; }
     else result[key]=new PlayerAudio{name=key,process=n,volume=vol,muted=mute};
    } catch {}
   }
  }
  return new List<PlayerAudio>(result.Values);
 }
 public static bool SetPlayer(string name,float? volume,bool? mute) {
  bool found=false; var want=Canonical(name);
  foreach(var e in AllSessions()) {
   int count; e.GetCount(out count);
   for(int i=0;i<count;i++) {
    try {
     IAudioSessionControl c; e.GetSession(i,out c); var n=ProcessOf(c); if(n==null||Canonical(n)!=want) continue;
     var v=(ISimpleAudioVolume)c; if(volume.HasValue)v.SetMasterVolume(volume.Value,Guid.Empty); if(mute.HasValue)v.SetMute(mute.Value,Guid.Empty); found=true;
    } catch {}
   }
  }
  return found;
 }
 // For the diagnostics page: which programs Windows sees on which output.
 public static List<string> Describe() {
  var lines=new List<string>(); int device=0;
  foreach(var e in AllSessions()) {
   device++; int count; e.GetCount(out count);
   for(int i=0;i<count;i++) {
    try { IAudioSessionControl c; e.GetSession(i,out c); var n=ProcessOf(c); if(n==null) continue; var v=(ISimpleAudioVolume)c; float vol; v.GetMasterVolume(out vol); lines.Add("output "+device+": "+n+" "+Math.Round(vol*100)+"%"); } catch {}
   }
  }
  return lines;
 }
}
