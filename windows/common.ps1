# Shared by the persistent host and the one-shot fallback.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if (-not ('AudioControl' -as [type])) { Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Native.cs')) -Language CSharp }

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
# Browsers are found by process as well as by "which window just came to the front":
# Windows often refuses to bring a freshly launched window forward, so the front-window
# check alone misses a browser that opened behind other windows.
$script:BrowserProcessNames=@{brave=@('brave');chrome=@('chrome');edge=@('msedge');firefox=@('firefox')}
$script:AllBrowserProcessNames=@('brave','chrome','msedge','firefox','opera','vivaldi')
function Get-DefaultBrowserKey {
  try { $progId=[string](Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId } catch { return '' }
  switch -Regex ($progId) { '^BraveHTML' {return 'brave'} '^ChromeHTML' {return 'chrome'} '^MSEdgeHTM' {return 'edge'} '^FirefoxURL' {return 'firefox'} default {return ''} }
}
function Find-BrowserWindow([string]$browser) {
  $names=@()
  if($browser -eq 'default'){ $d=Get-DefaultBrowserKey; if($d){$names+=$script:BrowserProcessNames[$d]}; $names+=$script:AllBrowserProcessNames }
  elseif($script:BrowserProcessNames.ContainsKey($browser)){ $names+=$script:BrowserProcessNames[$browser] }
  foreach($name in ($names | Select-Object -Unique)) {
    $p=Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle } | Select-Object -First 1
    if($p){ return [long]$p.MainWindowHandle }
  }
  return 0
}
function Get-CurrentWindow {
  $handle=[WinAudio]::ForegroundHandle()
  [pscustomobject]@{handle=$handle.ToInt64();title=[WinAudio]::WindowTitle($handle.ToInt64())}
}
function Wait-OpenedWindow([long]$previousHandle,[string]$previousTitle,$launchedProcess,[int]$tries=180) {
  for($i=0;$i -lt $tries;$i++) {
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

# ---- player volume that Windows cannot see (exclusive/ASIO output, or the player's own slider) ----
$script:MpcPort = 13579
# MPC-HC / K-Lite: optional web interface (Options > Player > Web Interface). Returns $null if it is not reachable.
function Invoke-MpcWeb([string]$path,[int]$timeoutMs=700) {
  $request=[Net.HttpWebRequest]::Create("http://127.0.0.1:$($script:MpcPort)$path")
  $request.Timeout=$timeoutMs; $request.ReadWriteTimeout=$timeoutMs; $request.AllowAutoRedirect=$false
  try { $response=$request.GetResponse() } catch [Net.WebException] { if($_.Exception.Response){$response=$_.Exception.Response}else{return $null} }
  try { $reader=New-Object IO.StreamReader($response.GetResponseStream()); return [string]$reader.ReadToEnd() } finally { $response.Close() }
}
function Get-MpcVolume {
  $html=Invoke-MpcWeb '/variables.html'
  if($html -and $html -match 'id="volumelevel">\s*(\d+)\s*<'){ $level=[int]$Matches[1]; return @{volume=$level;muted=($html -match 'id="muted">\s*1\s*<')} }
  return $null
}
function Set-MpcVolume([int]$percent) { return ($null -ne (Invoke-MpcWeb "/command.html?wm_command=-2&volume=$percent")) }
# Volume keys of each player, used when only relative steps are possible. what = up | down | mute
function Send-PlayerVolumeKey([string]$name,[string]$what) {
  if($name -like 'mpc-hc*') {
    $command=@{up=907;down=908;mute=909}[$what]
    if(-not [WinAudio]::PostPlayerCommand($name,$command)){throw 'Could not reach the MPC-HC window.'}
    return
  }
  # key, ctrl, alt: MusicBee's default hotkeys are Ctrl+Alt+Up / Down / V. VLC uses Ctrl+Up/Down and M. PotPlayer uses Up/Down and M.
  $keys=switch -Regex ($name) {
    '^musicbee$' { @{up=@(0x26,$true,$true);down=@(0x28,$true,$true);mute=@(0x56,$true,$true)} }
    '^vlc$'      { @{up=@(0x26,$true,$false);down=@(0x28,$true,$false);mute=@(0x4D,$false,$false)} }
    '^potplayer' { @{up=@(0x26,$false,$false);down=@(0x28,$false,$false);mute=@(0x4D,$false,$false)} }
    default      { $null }
  }
  if(-not $keys){throw 'This player has no volume keys known to RemoteDeck.'}
  if(-not [WinAudio]::ActivatePlayer($name)){throw 'Could not focus the selected player window.'}
  Start-Sleep -Milliseconds 80
  $k=$keys[$what]; [WinAudio]::Tap([byte]$k[0],[bool]$k[1],$false,[bool]$k[2])
}

function Send-PlayerSeek([string]$name,[int]$key,[int]$repeat) {
  if(!$name){throw 'Choose a player first.'}
  if(-not [WinAudio]::ActivatePlayer($name)){throw 'Could not focus the selected player window.'}
  Start-Sleep -Milliseconds 100
  $shift=($name -eq 'vlc')
  for($i=0;$i -lt $repeat;$i++){[WinAudio]::Tap([byte]$key,$false,$shift);if($i -lt ($repeat-1)){Start-Sleep -Milliseconds 90}}
}
