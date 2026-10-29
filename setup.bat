@echo off
setlocal
title Remote Media Control Setup
cd /d "%~dp0"
if /i "%~1"=="/start" goto start
:menu
cls
echo ======================================
echo       REMOTE MEDIA CONTROL
echo ======================================
echo.
echo   1. Install and start
echo      Create Desktop, Start menu, and Startup shortcuts
echo   2. Uninstall
echo      Stop listener and remove all shortcuts
echo   3. Disable automatic startup only
echo   4. Start the listener now
echo   5. Exit
echo.
choice /c 12345 /n /m "Choose an option: "
if errorlevel 5 goto end
if errorlevel 4 goto start
if errorlevel 3 goto disableStartup
if errorlevel 2 goto uninstall
if errorlevel 1 goto install

:install
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-actions.ps1" -Mode Install -Root "%~dp0."
if errorlevel 1 (
  echo Setup failed. Fix the error above and run setup.bat again.
  pause
  goto menu
)
echo.
echo Installed. The listener is starting in the tray.
pause
goto menu

:start
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-actions.ps1" -Mode Start -Root "%~dp0."
if errorlevel 1 (
  echo Could not start the listener. Check the error above.
  pause
  goto menu
)
echo Listener started in the system tray.
if /i "%~1"=="/start" goto end
pause
goto menu

:disableStartup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-actions.ps1" -Mode DisableStartup -Root "%~dp0."
if errorlevel 1 (
  echo Could not update the Startup shortcut.
  pause
  goto menu
)
echo Automatic startup disabled. Desktop and Start menu shortcuts were kept.
pause
goto menu

:uninstall
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-actions.ps1" -Mode Uninstall -Root "%~dp0."
if errorlevel 1 (
  echo Uninstall did not finish. Check the error above.
  pause
  goto menu
)
echo Listener stopped and shortcuts removed. Project files and APK were kept.
pause
goto menu

:end
endlocal
