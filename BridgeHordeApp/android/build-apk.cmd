@echo off
rem Builds the release APK and copies it to <repo root>\dist\HordeSurvival.apk.
rem Works from any directory, no environment setup needed.
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
cd /d "%~dp0"
rem arm64 only: every phone from the last several years; halves the APK size.
call "%~dp0gradlew.bat" assembleRelease -PreactNativeArchitectures=arm64-v8a
if errorlevel 1 exit /b %errorlevel%

set "DIST=%~dp0..\..\dist"
if not exist "%DIST%" mkdir "%DIST%"
copy /y "%~dp0app\build\outputs\apk\release\app-release.apk" "%DIST%\HordeSurvival.apk" >nul
echo.
echo APK copied to %DIST%\HordeSurvival.apk
