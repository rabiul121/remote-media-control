# Persistent input worker: mouse, keys and text, one JSON request per line.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Input.cs')) -Language CSharp

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
            'configure' { [MouseRemote]::Configure([string]$command.keyMethod,[string]$command.textMethod,[bool]$command.fallback) }
            default { throw 'Unknown mouse action.' }
        }
        @{id=$id;ok=$true} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    } catch {
        @{id=$id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    }
}
