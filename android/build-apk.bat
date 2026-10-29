@echo off
setlocal
cd /d "%~dp0"
set "SDKROOT=%LOCALAPPDATA%\Android\Sdk"
if not exist "%SDKROOT%" set "SDKROOT=C:\Android\Sdk"
if not exist "local.properties" echo sdk.dir=%SDKROOT:\=\\%>local.properties
call "%~dp0gradlew.bat" --no-daemon assembleDebug
if errorlevel 1 exit /b %errorlevel%
echo.
echo APK: %CD%\app\build\outputs\apk\debug\app-debug.apk
endlocal
