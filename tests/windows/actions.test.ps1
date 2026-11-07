$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$root = Join-Path $repo 'windows'
$work = $env:ACTIONS_TEST_DIR
$pass = 0; $fail = 0
function Ok($c, $m) { if ($c) { $script:pass++; "PASS $m" } else { $script:fail++; "FAIL $m" } }
# Runs the real state/control/power/diagnostics PowerShell against a mock of the native layer.
# Needs two dummy processes named MusicBee and mpc-hc64 and the fake MPC-HC web server (tests/run.js starts them).
# The native layer is replaced by the mock; common.ps1 then skips its own compile.
Add-Type -TypeDefinition (Get-Content -Raw (Join-Path $PSScriptRoot 'MockNative.cs')) -Language CSharp
. "$root/common.ps1"
. "$root/actions.ps1"
# Windows-only commands are replaced so the real action code can run here
$script:started = @()
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle, [switch]$Wait, [switch]$PassThru)
  $script:started += ("$FilePath " + ($ArgumentList -join ' ')); [pscustomobject]@{ ExitCode = $(if ($script:noShutdown) { 1116 } else { 0 }); Id = 1 } }
function Act($name, $payload) { [MockState]::Calls.Clear(); $r = @(Invoke-Action $name ([pscustomobject]$payload)) | Select-Object -Last 1; return $r }
function Ctl($payload) { Act 'control' $payload }
function Calls { [MockState]::Dump() }
function Err($sb) { try { & $sb; return $null } catch { return $_.Exception.Message } }
# ---------------- state ----------------
[MockState]::Players.Clear()
$s = (Act 'state' @{ detectBrowsers = $true; targetWindow = 0; explorerWindow = 0; browserWindow = 0 }) | ConvertFrom-Json
Ok ($s.systemVolume -eq 40 -and $s.capsLock -eq $true -and $s.foregroundTitle -eq 'Notepad') "state: basic fields (volume 40, caps lock on, foreground title)"
Ok ($s.foregroundElevated -eq $false -and $s.selfElevated -eq $false -and $s.foregroundBrowserWindow -eq 0) "state: elevation and browser fields present"
Ok ($s.PSObject.Properties.Name -contains 'browsers' -and $s.PSObject.Properties.Name -contains 'defaultBrowser') "state: browser detection included when asked"
$s2 = (Act 'state' @{ detectBrowsers = $false }) | ConvertFrom-Json; Ok ($null -eq $s2.browsers) "state: browser probe skipped when not asked"
Ok (($s.running -contains 'musicbee') -and ($s.running -contains 'mpc-hc64')) "state: finds the running players (MusicBee, MPC-HC): $($s.running -join ',')"
$mb = $s.players | Where-Object name -eq 'musicbee'
Ok ($mb.mode -eq 'keys' -and $null -eq $mb.volume) "MusicBee without a Windows session reports no slider level"
$p = New-Object PlayerAudio; $p.name = 'mpc-hc64'; $p.process = 'mpc-hc64'; $p.volume = 0.2; $p.muted = $false; [MockState]::Players.Add($p)
$s = (Act 'state' @{ detectBrowsers = $false }) | ConvertFrom-Json; $mp = $s.players | Where-Object name -eq 'mpc-hc64'
Ok ($mp.mode -eq 'web' -and $mp.volume -eq 60) "MPC-HC web volume overrides its mixer session"
$mb = $s.players | Where-Object name -eq 'musicbee'
$mp = $s.players | Where-Object name -eq 'mpc-hc64'
Ok ($mp.mode -eq 'web' -and $mp.volume -eq 60 -and $mp.muted -eq $false) "MPC-HC web interface reachable -> mode web, level 60 read from it"
New-Item -ItemType File -Path "$work/mpc-web-disabled" | Out-Null
$s = (Act 'state' @{ detectBrowsers = $false }) | ConvertFrom-Json; $mp = $s.players | Where-Object name -eq 'mpc-hc64'
Ok ($mp.mode -eq 'mixer' -and $mp.volume -eq 20) "without MPC-HC Web Interface, its per-app mixer session supplies the slider level"
Remove-Item "$work/mpc-web-disabled"
$p = New-Object PlayerAudio; $p.name = 'musicbee'; $p.process = 'musicbee'; $p.volume = 0.4; $p.muted = $false; [MockState]::Players.Add($p)
$s = (Act 'state' @{ detectBrowsers = $false }) | ConvertFrom-Json; $mb = $s.players | Where-Object name -eq 'musicbee'
Ok ($mb.mode -eq 'mixer' -and $mb.volume -eq 40) "MusicBee session supplies its absolute slider level"
Ok (@($s.players | Where-Object name -eq 'musicbee').Count -eq 1) "no duplicate entry for a player with a session"
[MockState]::ForegroundElevated = $true
$s = (Act 'state' @{}) | ConvertFrom-Json; Ok ($s.foregroundElevated -eq $true) "state reports an elevated app in front"
[MockState]::ForegroundElevated = $false

# ---------------- player volume ----------------
Remove-Item "$work/mpc.log" -ErrorAction SilentlyContinue
[void](Ctl @{ action = 'playerVolume'; player = 'musicbee'; value = 55 }); Ok ((Calls) -match 'SetPlayerVol musicbee 55') "volume: MusicBee slider sets its Windows app session"
[MockState]::Players.Clear()
$e = Err { Ctl @{ action = 'playerVolume'; player = 'musicbee'; value = 50 } }
Ok ($e -match 'no per-app audio session') "volume: MusicBee without a session reports why slider cannot act"
[void](Ctl @{ action = 'playerVolume'; player = 'mpc-hc64'; value = 50 }); Start-Sleep -Milliseconds 200
Ok ((Get-Content "$work/mpc.log" -ErrorAction SilentlyContinue) -contains '/command.html?wm_command=-2&volume=50') "volume: MPC-HC without a session -> set through its web interface (volume=50)"
$p = New-Object PlayerAudio; $p.name = 'mpc-hc64'; $p.process = 'mpc-hc64'; $p.volume = 0.2; $p.muted = $false; [MockState]::Players.Add($p)
[MockState]::Calls.Clear(); New-Item -ItemType File -Path "$work/mpc-web-disabled" | Out-Null
$e = Err { Ctl @{ action = 'playerVolume'; player = 'mpc-hc64'; value = 50 } }
Ok ($e -match 'no per-app audio session' -and (Calls) -notmatch 'SetPlayerVol') "volume: without MPC web or session, slider reports unavailable"
Remove-Item "$work/mpc-web-disabled"
[MockState]::Calls.Clear(); [void](Ctl @{ action = 'playerVolume'; player = 'mpc-hc64'; value = 50 }); Ok ((Calls) -match 'SetPlayerVol mpc-hc64 50') "volume: without MPC web, slider sets the app session"
[MockState]::Calls.Clear(); [void](Ctl @{ action = 'playerVolume'; player = 'mpc-hc64'; value = 50 }); Start-Sleep -Milliseconds 200
Ok ((Get-Content "$work/mpc.log" -ErrorAction SilentlyContinue) -contains '/command.html?wm_command=-2&volume=50' -and (Calls) -match 'SetPlayerVol mpc-hc64 100') "volume: MPC-HC web interface controls its internal level and keeps mixer gain neutral"
Ok ((Err { Ctl @{ action = 'playerVolume'; player = ''; value = 50 } }) -eq 'Choose a player first.') "volume: no player chosen"

# ---------------- volume steps ----------------
[void](Ctl @{ action = 'playerVolumeStep'; player = 'musicbee'; direction = 'up' }); Ok ((Calls) -eq 'ActivatePlayer musicbee|Tap 38 ctrl alt') "step: MusicBee up = focus it, Ctrl+Alt+Up"
[void](Ctl @{ action = 'playerVolumeStep'; player = 'musicbee'; direction = 'down' }); Ok ((Calls) -eq 'ActivatePlayer musicbee|Tap 40 ctrl alt') "step: MusicBee down = Ctrl+Alt+Down"
[void](Ctl @{ action = 'playerVolumeStep'; player = 'mpc-hc64'; direction = 'up' }); Ok ((Calls) -eq 'Post mpc-hc64 907') "step: MPC-HC up = WM_COMMAND 907, no focus needed"
[void](Ctl @{ action = 'playerVolumeStep'; player = 'mpc-hc64'; direction = 'down' }); Ok ((Calls) -eq 'Post mpc-hc64 908') "step: MPC-HC down = 908"
[void](Ctl @{ action = 'playerVolumeStep'; player = 'vlc'; direction = 'down' }); Ok ((Calls) -eq 'ActivatePlayer vlc|Tap 40 ctrl') "step: VLC down = Ctrl+Down"
Ok ((Err { Ctl @{ action = 'playerVolumeStep'; player = 'wmplayer'; direction = 'up' } }) -match 'no volume keys') "step: unknown player -> honest message"
[void](Ctl @{ action = 'playerMute'; player = 'mpc-hc64' }); Ok ((Calls) -eq 'Post mpc-hc64 909') "mute: MPC-HC uses its own mute command when web is unavailable"
$p = New-Object PlayerAudio; $p.name = 'vlc'; $p.process = 'vlc'; $p.volume = 0.3; $p.muted = $false; [MockState]::Players.Add($p)
[void](Ctl @{ action = 'playerMute'; player = 'vlc' }); Ok ((Calls) -eq 'SetPlayerMute vlc True') "mute: with a session -> toggles it"

# ---------------- selected-player transport ----------------
[void](Ctl @{ action = 'playPause'; player = 'vlc' }); Ok ((Calls) -eq 'ActivatePlayer vlc|Tap 32') "play/pause targets the selected VLC window, not the global media session"
[MockState]::Calls.Clear()
function Test-PlayerRunning([string]$name) { return $false }
function Get-PlayerExecutable([string]$name) { return 'MusicBee.exe' }
$script:started = @()
[void](Ctl @{ action = 'playPause'; player = 'musicbee' })
Ok ($script:started -contains 'MusicBee.exe ' -and (Calls) -eq 'ActivatePlayer musicbee|Tap 32') "play/pause opens closed MusicBee before sending play"
Remove-Item Function:\Test-PlayerRunning,Function:\Get-PlayerExecutable
[void](Ctl @{ action = 'next'; player = 'musicbee' }); Ok ((Calls) -eq 'AppCommand musicbee 11') "next sends APPCOMMAND_MEDIA_NEXTTRACK directly to MusicBee"
[void](Ctl @{ action = 'previous'; player = 'musicbee' }); Ok ((Calls) -eq 'AppCommand musicbee 12') "previous sends APPCOMMAND_MEDIA_PREVIOUSTRACK directly to MusicBee"
[void](Ctl @{ action = 'previous'; player = 'mpc-hc64' }); Ok ((Calls) -eq 'ActivatePlayer mpc-hc64|Tap 33') "previous targets MPC-HC with its track shortcut"

# ---------------- seeking must not restore a maximized window ----------------
[void](Ctl @{ action = 'seekForward'; player = 'musicbee' }); Ok ((Calls) -match 'ActivatePlayer musicbee') "seek: focuses the player via ActivatePlayer (which only restores minimized windows)"

# ---------------- power ----------------
[void](Ctl @{ action = 'power'; what = 'lock' }); Ok ((Calls) -eq 'Lock') "power: lock"
[void](Ctl @{ action = 'power'; what = 'sleep' }); Ok ((Calls) -eq 'Sleep') "power: sleep"
[void](Ctl @{ action = 'power'; what = 'displayOff' }); Ok ((Calls) -eq 'DisplayOff') "power: screen off"
$script:started = @(); [void](Ctl @{ action = 'power'; what = 'restart' }); Ok ($script:started[0] -match 'shutdown.exe /r /t 15') "power: restart waits 15 s ($($script:started[0]))"
$script:started = @(); [void](Ctl @{ action = 'power'; what = 'shutdown' }); Ok ($script:started[0] -match 'shutdown.exe /s /t 15') "power: shutdown waits 15 s"
$script:started = @(); [void](Ctl @{ action = 'power'; what = 'cancel' }); Ok ($script:started[0] -match 'shutdown.exe /a') "power: cancel runs shutdown /a"
$script:noShutdown = $true; Ok ((Err { Ctl @{ action = 'power'; what = 'cancel' } }) -match 'No shutdown') "power: cancel with nothing pending -> clear message"; $script:noShutdown = $false
Ok ((Err { Ctl @{ action = 'power'; what = 'format' } }) -eq 'Unknown power action.') "power: unknown action refused"

# ---------------- diagnostics ----------------
$d = (Act 'diagnostics' @{}) | ConvertFrom-Json
Ok ($d.audio -contains 'output 1: vlc 50%' -and $d.mpcWeb -eq $true -and $d.elevated -eq $false -and $d.psVersion) "diagnostics: audio sessions, MPC web interface, elevation, PowerShell version"

# ---------------- system volume, window actions ----------------
[void](Ctl @{ action = 'systemVolume'; value = 30 }); Ok ((Calls) -match 'SysVol 30') "system volume"
[void](Ctl @{ action = 'systemMute' }); Ok ((Calls) -eq 'SysMute') "system mute"
"`n$pass passed, $fail failed"; if ($fail) { exit 1 }
