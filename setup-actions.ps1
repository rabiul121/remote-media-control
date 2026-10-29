param([Parameter(Mandatory=$true)][ValidateSet('Install','Start','DisableStartup','Uninstall')][string]$Mode,[Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$tray = Join-Path $Root 'windows-tray.ps1'
$powershell = (Get-Command powershell.exe).Source
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startup = Join-Path $programs 'Startup'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell

function Start-Tray {
    $existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('windows-tray.ps1') }
    if (!$existing) { Start-Process -FilePath $powershell -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-STA','-WindowStyle','Hidden','-File',$tray) -WindowStyle Hidden }
}
function Stop-Remote {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.Name -match '^powershell(\.exe)?$' -and $_.CommandLine.Contains('windows-tray.ps1') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $pidFile = Join-Path $env:LOCALAPPDATA 'RemoteMediaControl\listener.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $number = Get-Content -LiteralPath $pidFile -Raw
        if ($number -match '^\d+$') {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$number"
            if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.js') { Stop-Process -Id ([int]$number) -Force -ErrorAction SilentlyContinue }
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
}
function Remove-Links([bool]$all) {
    $paths = @((Join-Path $desktop 'Remote Media Control.lnk'),(Join-Path $programs 'Remote Media Control.lnk'),(Join-Path $startup 'Remote Media Control.lnk'))
    if (!$all) { $paths = @((Join-Path $startup 'Remote Media Control.lnk')) }
    foreach($path in $paths) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}

switch ($Mode) {
    'Install' {
        Push-Location $Root
        try { & npm.cmd install --omit=dev --no-audit --no-fund; if($LASTEXITCODE -ne 0){throw 'Could not install the server dependency. Check the internet connection and run setup.bat again.'} } finally { Pop-Location }
        foreach($path in @((Join-Path $desktop 'Remote Media Control.lnk'),(Join-Path $programs 'Remote Media Control.lnk'),(Join-Path $startup 'Remote Media Control.lnk'))) {
            $shortcut = $shell.CreateShortcut($path)
            $shortcut.TargetPath = $powershell
            $shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$tray`""
            $shortcut.WorkingDirectory = $Root
            $shortcut.Description = 'Start the Remote Media listener in the system tray'
            $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,101"
            $shortcut.Save()
        }
        Start-Tray
    }
    'Start' { Start-Tray }
    'DisableStartup' { Remove-Links $false }
    'Uninstall' { Stop-Remote; Remove-Links $true }
}
