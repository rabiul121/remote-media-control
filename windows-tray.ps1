$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $env:LOCALAPPDATA 'RemoteMediaControl'
$log = Join-Path $logDir 'listener.log'
$pidFile = Join-Path $logDir 'listener.pid'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Start-Listener {
    if ($script:listener -and -not $script:listener.HasExited) { return }
    $script:pin = (Get-Random -Minimum 100000 -Maximum 1000000).ToString()
    $script:listener = Start-Process -FilePath $node -ArgumentList @('server.js',$script:pin) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logDir 'listener-error.log')
    $script:icon.Text = 'Remote Media: starting'
}
function Get-ListenerInfo {
    $adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Sort-Object @{Expression={if($_.Name -match 'wi-?fi|wireless|wlan'){0}else{1}}})
    $addresses = @($adapters | ForEach-Object { Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue } | Where-Object { $_.AddressState -eq 'Preferred' -and !$_.IPAddress.StartsWith('169.254.') } | Select-Object -ExpandProperty IPAddress -Unique | ForEach-Object { "http://${_}:8765" })
    return "For one-scan setup, choose Show pairing QR... and scan it in the Android app.`r`n`r`nWi-Fi address(es):`r`n$($addresses -join "`r`n")`r`nPairing code: $script:pin`r`n`r`nKeep both devices on the same Wi-Fi network."
}

$script:icon = New-Object System.Windows.Forms.NotifyIcon
$logoPath = Join-Path $root 'assets\remote-media.ico'
if (Test-Path -LiteralPath $logoPath) { $script:icon.Icon = New-Object System.Drawing.Icon($logoPath) } else { $script:icon.Icon = [System.Drawing.SystemIcons]::Application }
$script:icon.Text = 'Remote Media Control'
$script:icon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$pair = $menu.Items.Add('Pair phone...')
$pair.Add_Click({ [System.Windows.Forms.MessageBox]::Show((Get-ListenerInfo),'Remote Media Control',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null })
$qr = $menu.Items.Add('Show pairing QR...')
$qr.Add_Click({ Start-Process 'http://127.0.0.1:8765/pair-qr' })
$open = $menu.Items.Add('Open remote on this PC')
$open.Add_Click({ Start-Process 'http://127.0.0.1:8765' })
$restart = $menu.Items.Add('Restart listener')
$restart.Add_Click({ if($script:listener -and -not $script:listener.HasExited){Stop-Process -Id $script:listener.Id -Force}; Start-Sleep -Milliseconds 300; Start-Listener })
$menu.Items.Add('-') | Out-Null
$exit = $menu.Items.Add('Exit')
$exit.Add_Click({ $script:timer.Stop();if($script:listener -and -not $script:listener.HasExited){Stop-Process -Id $script:listener.Id -Force};Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue;$script:icon.Visible=$false;$script:icon.Dispose();[System.Windows.Forms.Application]::Exit() })
$script:icon.ContextMenuStrip = $menu
$script:icon.Add_DoubleClick({ Start-Process 'http://127.0.0.1:8765' })
$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 2500
$script:timer.Add_Tick({ if(!$script:listener -or $script:listener.HasExited){Start-Listener} })
Start-Listener
$script:timer.Start()
[System.Windows.Forms.Application]::Run()
