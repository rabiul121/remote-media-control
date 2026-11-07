# Every remote action. Called as Invoke-Action <name> <payload>.
# Whatever is emitted last is the result (JSON text, or a window handle).
function Invoke-Action([string]$Action,$payload) {
if ($Action -eq 'browse') {
  $requested=[string]$payload.path
  if(!$requested) {
    $drives=@(Get-PSDrive -PSProvider FileSystem | ForEach-Object { [pscustomobject]@{name=$_.Name;path=$_.Root;kind='drive'} })
    [pscustomobject]@{path='';parent='';drives=$drives;folders=@();files=@()} | ConvertTo-Json -Compress -Depth 5
  } else {
    $item=Get-Item -LiteralPath $requested -ErrorAction Stop
    if(!$item.PSIsContainer){throw 'That path is not a folder.'}
    $folders=@(Get-ChildItem -LiteralPath $item.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=$_.Name;path=$_.FullName;kind='folder'} })
    $extensions=@($payload.mediaExtensions | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() })
    $files=@(Get-ChildItem -LiteralPath $item.FullName -File -ErrorAction SilentlyContinue | ForEach-Object { $ext=$_.Extension.ToLowerInvariant(); if($extensions -contains $ext){[pscustomobject]@{name=$_.Name;path=$_.FullName;kind='media';bytes=$_.Length}}else{[pscustomobject]@{name=$_.Name;path=$_.FullName;kind='file';bytes=$_.Length}} })
    [pscustomobject]@{path=$item.FullName;parent=$item.Parent.FullName;drives=@();folders=$folders;files=$files} | ConvertTo-Json -Compress -Depth 5
  }
  return
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
  (ConvertTo-Json -InputObject $items -Compress -Depth 3)
  return
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
  $running = @($procs | ForEach-Object { switch -Regex ($_.ToLowerInvariant()) { '^mpc-hc$' { 'mpc-hc64' } '^potplayermini' { 'potplayer' } default { $_.ToLowerInvariant() } } } | Select-Object -Unique)
  # mode: mixer = Windows per-app volume; web = the player's own web interface (MPC-HC); keys = only the player's volume keys work
  $sessionPlayers = @([AudioControl]::GetPlayers() | ForEach-Object { [pscustomobject]@{name=$_.name;volume=[math]::Round($_.volume*100);muted=$_.muted;mode='mixer'} })
  $active = @($sessionPlayers)
  foreach($runName in $running) {
    if($runName -eq 'mpc-hc64') {
      $web = Get-MpcVolume
      if($web) {
        $active = @($active | Where-Object { $_.name -ne $runName })
        $active += [pscustomobject]@{name=$runName;volume=$web.volume;muted=$web.muted;mode='web'}
        continue
      }
    }
    if(@($sessionPlayers | Where-Object { $_.name -eq $runName }).Count -gt 0) { continue }
    $active += [pscustomobject]@{name=$runName;volume=$null;muted=$null;mode='keys'}
  }
  $foreground=Get-CurrentWindow
  $foregroundPid=[WinAudio]::WindowProcessId([long]$foreground.handle)
  $foregroundElevated=if($foregroundPid){[WinAudio]::IsProcessElevated([uint32]$foregroundPid)}else{$false}
  $selfElevated=[WinAudio]::SelfElevated()
  $foregroundProcess=if($foregroundPid){Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue}else{$null}
  $foregroundName=if($foregroundProcess){$foregroundProcess.ProcessName}else{''}
  $foregroundWindow=if($foreground.title -and $foregroundName -notmatch '^(powershell|pwsh|node|conhost|explorer|SearchHost|ShellExperienceHost|StartMenuExperienceHost|TextInputHost|LockApp)$'){[long]$foreground.handle}else{0}
  $foregroundBrowserWindow=if($foreground.title -and $foregroundName -in $script:AllBrowserProcessNames){[long]$foreground.handle}else{0}
  $browserOwner=[WinAudio]::WindowProcessId([long]$payload.browserWindow)
  $browserProcess=if($browserOwner){Get-Process -Id $browserOwner -ErrorAction SilentlyContinue}else{$null}
  $browserTargetWindowExists=[WinAudio]::WindowExists([long]$payload.browserWindow) -and $browserProcess -and ($browserProcess.ProcessName -in $script:AllBrowserProcessNames)
  $browserFallbackWindow=if(-not $foregroundBrowserWindow -and -not $browserTargetWindowExists){Find-BrowserWindow 'default'}else{0}
  $defaultBrowser=if($payload.detectBrowsers){Get-DefaultBrowserKey}else{$null}
  $foregroundTitle=[string]$foreground.title; if($foregroundTitle.Length -gt 120){$foregroundTitle=$foregroundTitle.Substring(0,120)}
  $foregroundExplorerWindow=if($foreground.title -and $foregroundName -eq 'explorer'){[long]$foreground.handle}else{0}
  $targetOwner=[WinAudio]::WindowProcessId([long]$payload.targetWindow)
  $targetProcess=if($targetOwner){Get-Process -Id $targetOwner -ErrorAction SilentlyContinue}else{$null}
  $targetWindowExists=[WinAudio]::WindowExists([long]$payload.targetWindow) -and $targetProcess -and $targetProcess.ProcessName -notmatch '^(powershell|pwsh|node|conhost|explorer|SearchHost|ShellExperienceHost|StartMenuExperienceHost|TextInputHost|LockApp)$'
  $explorerOwner=[WinAudio]::WindowProcessId([long]$payload.explorerWindow)
  $explorerProcess=if($explorerOwner){Get-Process -Id $explorerOwner -ErrorAction SilentlyContinue}else{$null}
  $explorerTargetWindowExists=[WinAudio]::WindowExists([long]$payload.explorerWindow) -and $explorerProcess -and $explorerProcess.ProcessName -eq 'explorer'
  [pscustomobject]@{systemVolume=[math]::Round($vol*100);systemMuted=$mute;players=$active;running=$running;browsers=$availableBrowsers;foregroundWindow=$foregroundWindow;foregroundExplorerWindow=$foregroundExplorerWindow;capsLock=[WinAudio]::IsKeyLocked(0x14);numLock=[WinAudio]::IsKeyLocked(0x90);scrollLock=[WinAudio]::IsKeyLocked(0x91);targetWindowExists=[bool]$targetWindowExists;explorerTargetWindowExists=[bool]$explorerTargetWindowExists;foregroundBrowserWindow=$foregroundBrowserWindow;browserTargetWindowExists=[bool]$browserTargetWindowExists;browserFallbackWindow=[long]$browserFallbackWindow;defaultBrowser=$defaultBrowser;foregroundTitle=$foregroundTitle;foregroundProcess=$foregroundName;foregroundElevated=[bool]$foregroundElevated;selfElevated=[bool]$selfElevated} | ConvertTo-Json -Compress -Depth 4
  return
}

if ($Action -eq 'diagnostics') {
  $info=[ordered]@{
    psVersion=$PSVersionTable.PSVersion.ToString(); user=$env:USERNAME; machine=$env:COMPUTERNAME
    session=[Diagnostics.Process]::GetCurrentProcess().SessionId; elevated=[bool][WinAudio]::SelfElevated()
    audio=@([AudioControl]::Describe()); mpcWeb=[bool](Get-MpcVolume); defaultBrowser=(Get-DefaultBrowserKey)
  }
  return (ConvertTo-Json -InputObject $info -Compress -Depth 4)
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
      try { $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched 60 } catch { $handle=0 }
      $owner=if($handle){[WinAudio]::WindowProcessId([long]$handle)}else{0}
      $opened=if($owner){Get-Process -Id $owner -ErrorAction SilentlyContinue}else{$null}
      if(-not $opened -or $opened.ProcessName -notin $script:AllBrowserProcessNames) { $handle=Find-BrowserWindow $browser }
      if(-not $handle){throw 'The browser opened, but its window was not found. Click the browser window on the PC once, then tap Refresh.'}
      [void][WinAudio]::ActivateWindow([long]$handle)
      $handle
      return
    }
    { $_ -in @('browserFocus','browserAddressBar','browserBack','browserForward','browserReload','browserHome','browserArrowUp','browserArrowDown','browserArrowLeft','browserArrowRight','browserScrollUp','browserScrollDown','browserTab','browserShiftTab','browserEnter','browserEscape','browserCloseTab') } {
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
        'browserAddressBar' {if(-not [WinAudio]::SendBrowserKey($handle,0x4C,$true)){throw 'Could not send input to the browser.'}}
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
    { $_ -in @('playPause','play','pause','next','previous') } { Send-PlayerTransport $player $a }
    'seekSmallForward' { Send-PlayerSeek $player 0x27 1 }
    'seekSmallBackward' { Send-PlayerSeek $player 0x25 1 }
    'seekLargeForward' { Send-PlayerSeek $player 0x27 6 }
    'seekLargeBackward' { Send-PlayerSeek $player 0x25 6 }
    'activatePlayer' {
      if(!$player){throw 'Choose a player first.'}
      if(-not [WinAudio]::ActivatePlayer($player)){throw 'Could not focus the selected player window.'}
    }
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
          for($wait=0;$wait -lt 30;$wait++){if(-not [WinAudio]::WindowExists($handle)){return};Start-Sleep -Milliseconds 50}
        }
        foreach($windowProcess in (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
          $candidate=[long]$windowProcess.MainWindowHandle
          if($candidate -and [WinAudio]::CloseWindow($candidate)) {
            for($wait=0;$wait -lt 30;$wait++){if(-not [WinAudio]::WindowExists($candidate)){return};Start-Sleep -Milliseconds 50}
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
    'playerVolume' {
      if(!$player){throw 'Choose a player first.'}
      if($player -eq 'mpc-hc64') {
        if(Get-MpcVolume) {
          if(-not (Set-MpcVolume ([int][math]::Round($value*100)))) { throw 'MPC-HC did not confirm the requested volume. Check its Web Interface on port 13579.' }
          [AudioControl]::SetPlayer($player,[Nullable[single]]1.0,$null) | Out-Null
          return
        }
      }
      if(-not [AudioControl]::SetPlayer($player,[Nullable[single]]([single]$value),$null)) { throw "Windows has no per-app audio session for $player. Start playback in shared audio mode to use its volume slider." }
    }
    'playerVolumeStep' { if(!$player){throw 'Choose a player first.'}; Send-PlayerVolumeKey $player ([string]$payload.direction) }
    'power' {
      switch ([string]$payload.what) {
        'lock' { [void][WinAudio]::Lock() }
        'sleep' { [void][WinAudio]::Sleep() }
        'displayOff' { [WinAudio]::DisplayOff() }
        'restart' { Start-Process -FilePath shutdown.exe -ArgumentList '/r','/t','15','/c','"RemoteDeck: restarting in 15 seconds"' -WindowStyle Hidden }
        'shutdown' { Start-Process -FilePath shutdown.exe -ArgumentList '/s','/t','15','/c','"RemoteDeck: shutting down in 15 seconds"' -WindowStyle Hidden }
        'cancel' { $p=Start-Process -FilePath shutdown.exe -ArgumentList '/a' -WindowStyle Hidden -Wait -PassThru; if($p.ExitCode -ne 0){throw 'No shutdown or restart is pending.'} }
        default { throw 'Unknown power action.' }
      }
    }
    'playerMute' {
      if(!$player){throw 'Choose a player first.'}
      if($player -eq 'mpc-hc64' -and -not (Get-MpcVolume)) { Send-PlayerVolumeKey $player 'mute'; return }
      $all=@([AudioControl]::GetPlayers() | Where-Object { $_.name -eq $player })
      if($all.Count -gt 0) { $mute = -not [bool]$all[0].muted; [AudioControl]::SetPlayer($player,$null,[Nullable[bool]]$mute) | Out-Null }
      else { Send-PlayerVolumeKey $player 'mute' }
    }
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
      if(@($payload.mediaExtensions | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() }) -notcontains ([IO.Path]::GetExtension($file).ToLowerInvariant())){throw 'That file type is not supported.'}
      $exe=Get-PlayerExecutable $player
      $fileArgument='"'+$file.Replace('"','\"')+'"'
      if($player -eq 'vlc'){$fileArgument='--started-from-file '+$fileArgument}
      Start-Process -FilePath $exe -ArgumentList $fileArgument | Out-Null
    }
    'openDefaultFile' {
      $file=[string]$payload.path
      if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'That file is not available.'}
      if(@($payload.mediaExtensions | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() }) -contains ([IO.Path]::GetExtension($file).ToLowerInvariant())){throw 'Audio and video files should be opened with the selected player.'}
      $before=Get-CurrentWindow
      $launched=Start-Process -FilePath $file -PassThru
      $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched
      $handle
      return
    }
    'openFolder' { $folder=[string]$payload.path; if(!(Test-Path -LiteralPath $folder -PathType Container)){throw 'That folder is not available.'}; $before=Get-CurrentWindow; $launched=Start-Process -FilePath explorer.exe -ArgumentList ('"'+$folder.Replace('"','\"')+'"') -PassThru; $handle=Wait-OpenedWindow ([long]$before.handle) ([string]$before.title) $launched; $handle; return }
    'seekForward' { Send-PlayerSeek $player 0x27 1 }
    'seekBackward' { Send-PlayerSeek $player 0x25 1 }
  }
  '{"ok":true}'
}
}
