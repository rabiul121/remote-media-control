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
            default { throw 'Unknown mouse action.' }
        }
        @{id=$id;ok=$true} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    } catch {
        @{id=$id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    }
}
