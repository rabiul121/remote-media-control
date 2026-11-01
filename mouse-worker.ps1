$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MouseRemote {
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,int dx,int dy,uint data,UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort virtualKey; public ushort scanCode; public uint flags; public uint time; public UIntPtr extraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx; public int dy; public uint data; public uint flags; public uint time; public UIntPtr extraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KeyboardInput keyboard; [FieldOffset(0)] public MouseInput mouse; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion value; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  const uint KEYUP=0x0002, KEYEXTENDED=0x0001;
  static readonly Dictionary<IntPtr,int> zoomSteps = new Dictionary<IntPtr,int>();
  // Home, End, arrows, PgUp/PgDn, Ins/Del and Win are "extended" keys. Sending them without
  // KEYEVENTF_EXTENDEDKEY makes some apps read them as the numeric-keypad twins (Num 7 / Num 1).
  static bool IsExtended(byte k) { return (k>=0x21&&k<=0x28)||k==0x2D||k==0x2E||k==0x5B||k==0x5C; }
  static Input Key(byte key,bool up=false) { uint flags=(up?KEYUP:0u)|(IsExtended(key)?KEYEXTENDED:0u); return new Input{type=1,value=new InputUnion{keyboard=new KeyboardInput{virtualKey=key,flags=flags}}}; }
  static Input Mouse(uint flags,int dx=0,int dy=0,uint data=0) { return new Input{type=0,value=new InputUnion{mouse=new MouseInput{dx=dx,dy=dy,data=data,flags=flags}}}; }
  static Input WheelInput(int delta) { return new Input{type=0,value=new InputUnion{mouse=new MouseInput{data=unchecked((uint)delta),flags=0x0800}}}; }
  static void Send(Input[] inputs) {
    uint sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input)));
    if(sent!=inputs.Length) throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows accepted "+sent+" of "+inputs.Length+" simulated input events. The target may be elevated or Windows may have rejected the input.");
  }
  public static void Move(int dx,int dy) { mouse_event(0x0001,dx,dy,0,UIntPtr.Zero); }
  public static void Down(int button) { uint flag=(uint)(button==0?0x0002:button==1?0x0008:0x0020); Send(new Input[]{Mouse(flag)}); }
  public static void Up(int button) { uint flag=(uint)(button==0?0x0004:button==1?0x0010:0x0040); Send(new Input[]{Mouse(flag)}); }
  public static void Click(int button) { Down(button); System.Threading.Thread.Sleep(30); Up(button); }
  public static void Wheel(int delta) { Send(new Input[]{WheelInput(delta)}); }
  const uint KEYUNICODE=0x0004;
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static bool IsDown(int vk) { return (GetAsyncKeyState(vk)&0x8000)!=0; }
  static Input UnicodeKey(char c,bool up) { return new Input{type=1,value=new InputUnion{keyboard=new KeyboardInput{virtualKey=0,scanCode=c,flags=KEYUNICODE|(up?KEYUP:0u)}}}; }
  // Release a modifier that is still down on the PC but was not asked for (for example a stuck Alt).
  static void AddReleases(List<Input> list,bool stuck,params byte[] keys) { if(!stuck) return; foreach(var k in keys) list.Add(Key(k,true)); }
  static Input[] KeyPressInputs(byte vk,bool ctrl,bool shift,bool alt,bool win,bool stuckCtrl,bool stuckShift,bool stuckAlt,bool stuckWin) {
    var list=new List<Input>();
    AddReleases(list,stuckCtrl,0x11,0xA2,0xA3); AddReleases(list,stuckShift,0x10,0xA0,0xA1);
    AddReleases(list,stuckAlt,0x12,0xA4,0xA5); AddReleases(list,stuckWin,0x5B,0x5C);
    if(win) list.Add(Key(0x5B)); if(ctrl) list.Add(Key(0x11)); if(shift) list.Add(Key(0x10)); if(alt) list.Add(Key(0x12));
    list.Add(Key(vk)); list.Add(Key(vk,true));
    if(alt) list.Add(Key(0x12,true)); if(shift) list.Add(Key(0x10,true)); if(ctrl) list.Add(Key(0x11,true)); if(win) list.Add(Key(0x5B,true));
    return list.ToArray();
  }
  static Input[] TextInputs(string text) {
    var list=new List<Input>();
    foreach(char c in text) {
      if(c=='\r') continue;
      if(c=='\n') { list.Add(Key(0x0D)); list.Add(Key(0x0D,true)); }
      else if(c=='\t') { list.Add(Key(0x09)); list.Add(Key(0x09,true)); }
      else { list.Add(UnicodeKey(c,false)); list.Add(UnicodeKey(c,true)); }
    }
    return list.ToArray();
  }
  public static void KeyPress(byte vk,bool ctrl,bool shift,bool alt,bool win) {
    var inputs=KeyPressInputs(vk,ctrl,shift,alt,win,!ctrl&&IsDown(0x11),!shift&&IsDown(0x10),!alt&&IsDown(0x12),!win&&(IsDown(0x5B)||IsDown(0x5C)));
    try { Send(inputs); }
    catch { try { Send(KeyPressInputs(0x07,false,false,false,false,true,true,true,true)); } catch {} throw; }
  }
  public static void TypeText(string text) {
    var inputs=TextInputs(text); const int chunk=200;
    for(int i=0;i<inputs.Length;i+=chunk) { int n=Math.Min(chunk,inputs.Length-i); var part=new Input[n]; Array.Copy(inputs,i,part,0,n); Send(part); }
  }
  public static void Home() { Send(new Input[]{Key(0x11),Key(0x24),Key(0x24,true),Key(0x11,true)}); }
  public static void End() { Send(new Input[]{Key(0x11),Key(0x23),Key(0x23,true),Key(0x11,true)}); }
  public static void CtrlWheel(int delta) { CtrlWheel(delta,1); }
  static void CtrlWheel(int delta,int count) {
    var inputs=new List<Input>(count+2);
    inputs.Add(Key(0x11));
    for(int i=0;i<count;i++) inputs.Add(WheelInput(delta));
    inputs.Add(Key(0x11,true));
    try { Send(inputs.ToArray()); }
    catch { try { Send(new Input[]{Key(0x11,true)}); } catch {} throw; }
  }
  static IntPtr ZoomTarget() {
    IntPtr target=GetForegroundWindow();
    if(target==IntPtr.Zero) throw new InvalidOperationException("No foreground window is available for zoom.");
    return target;
  }
  static int CurrentZoomSteps(IntPtr target) {
    int current; zoomSteps.TryGetValue(target,out current); return current;
  }
  static void RememberZoom(IntPtr target,int delta) {
    int current=CurrentZoomSteps(target);
    current+=delta;
    if(current==0) zoomSteps.Remove(target); else zoomSteps[target]=current;
  }
  static void CheckZoomLimit(IntPtr target,int delta) {
    int current=CurrentZoomSteps(target);
    if((delta>0&&current>=100)||(delta<0&&current<=-100))
      throw new InvalidOperationException("Zoom tracking reached its limit. Reset zoom for this window before continuing.");
  }
  public static void ZoomIn() {
    IntPtr target=ZoomTarget(); CheckZoomLimit(target,1); CtrlWheel(120); RememberZoom(target,1);
  }
  public static void ZoomOut() {
    IntPtr target=ZoomTarget(); CheckZoomLimit(target,-1); CtrlWheel(-120); RememberZoom(target,-1);
  }
  public static void ZoomReset() {
    IntPtr target=ZoomTarget(); int current;
    if(!zoomSteps.TryGetValue(target,out current) || current==0)
      throw new InvalidOperationException("RemoteDeck has no zoom changes recorded for this window yet.");
    int reverseDelta=current>0?-120:120;
    int count=Math.Abs(current);
    CtrlWheel(reverseDelta,count);
    zoomSteps.Remove(target);
  }
}
'@
Add-Type -TypeDefinition $native -Language CSharp

function Resolve-Vk([string]$key) {
    if ($key -match '^[A-Z0-9]$') { return [byte][char]$key }
    if ($key -match '^F([1-9]|1[0-9]|2[0-4])$') { return [byte](0x70 + [int]$Matches[1] - 1) }
    if ($key -match '^NUM([0-9])$') { return [byte](0x60 + [int]$Matches[1]) }
    $map = @{SPACE=0x20;ENTER=0x0D;TAB=0x09;ESCAPE=0x1B;BACKSPACE=0x08;DELETE=0x2E;INSERT=0x2D;HOME=0x24;END=0x23;PAGEUP=0x21;PAGEDOWN=0x22;UP=0x26;DOWN=0x28;LEFT=0x25;RIGHT=0x27;CAPSLOCK=0x14;NUMLOCK=0x90;SCROLLLOCK=0x91;PRINTSCREEN=0x2C;PAUSE=0x13;EQUALS=0xBB;MINUS=0xBD;COMMA=0xBC;PERIOD=0xBE;SLASH=0xBF;BACKSLASH=0xDC;SEMICOLON=0xBA;QUOTE=0xDE;LBRACKET=0xDB;RBRACKET=0xDD;BACKQUOTE=0xC0;NUMADD=0x6B;NUMSUBTRACT=0x6D;NUMMULTIPLY=0x6A;NUMDIVIDE=0x6F;NUMDECIMAL=0x6E;NUMENTER=0x0D;WIN=0x5B;ALTGR=0xA5;MENU=0x5D}
    if ($map.ContainsKey($key)) { return [byte]$map[$key] }
    throw 'Unsupported keyboard key.'
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $id = $null
    try {
        $command = $line | ConvertFrom-Json
        $id = $command.id
        switch ($command.action) {
            'mouseMove' { [MouseRemote]::Move([int]$command.dx,[int]$command.dy) }
            'mouseLeftDown' { [MouseRemote]::Down(0) }
            'mouseLeftUp' { [MouseRemote]::Up(0) }
            'mouseLeftClick' { [MouseRemote]::Click(0) }
            'mouseRightClick' { [MouseRemote]::Click(1) }
            'mouseMiddleClick' { [MouseRemote]::Click(2) }
            'mouseDoubleClick' { [MouseRemote]::Click(0); Start-Sleep -Milliseconds 90; [MouseRemote]::Click(0) }
            'mouseScrollUp' { [MouseRemote]::Wheel(120) }
            'mouseScrollDown' { [MouseRemote]::Wheel(-120) }
            'mouseHome' { [MouseRemote]::Home() }
            'mouseEnd' { [MouseRemote]::End() }
            'mouseZoomIn' { [MouseRemote]::ZoomIn() }
            'mouseZoomOut' { [MouseRemote]::ZoomOut() }
            'mouseZoomReset' { [MouseRemote]::ZoomReset() }
            'mouseGestureZoomIn' { [MouseRemote]::ZoomIn() }
            'mouseGestureZoomOut' { [MouseRemote]::ZoomOut() }
            'keyboardPress' { $m = $command.modifiers; [MouseRemote]::KeyPress((Resolve-Vk ([string]$command.key)),[bool]$m.ctrl,[bool]$m.shift,[bool]$m.alt,[bool]$m.win) }
            'typeText' { [MouseRemote]::TypeText([string]$command.text) }
            default { throw 'Unknown mouse action.' }
        }
        @{id=$id;ok=$true} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    } catch {
        @{id=$id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    }
}
