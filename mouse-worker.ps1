$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$native = @'
using System;
using System.Runtime.InteropServices;

public static class MouseRemote {
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,int dx,int dy,uint data,UIntPtr extra);
  public static void Move(int dx,int dy) { mouse_event(0x0001,dx,dy,0,UIntPtr.Zero); }
  public static void Down(int button) { uint flag=(uint)(button==0?0x0002:button==1?0x0008:0x0020); mouse_event(flag,0,0,0,UIntPtr.Zero); }
  public static void Up(int button) { uint flag=(uint)(button==0?0x0004:button==1?0x0010:0x0040); mouse_event(flag,0,0,0,UIntPtr.Zero); }
  public static void Click(int button) { Down(button); System.Threading.Thread.Sleep(30); Up(button); }
  public static void Wheel(int delta) { mouse_event(0x0800,0,0,unchecked((uint)delta),UIntPtr.Zero); }
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
            default { throw 'Unknown mouse action.' }
        }
        @{id=$id;ok=$true} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    } catch {
        @{id=$id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    }
}
