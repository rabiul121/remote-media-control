@echo off
cd /d "%~dp0"
start "" /b wscript.exe //B "%~dp0start-hidden.vbs"
endlocal
