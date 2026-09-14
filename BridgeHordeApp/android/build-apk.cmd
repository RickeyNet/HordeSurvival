@echo off
rem Builds the release APK and copies it to <repo root>\dist\HordeSurvival-<version>.apk.
rem Works from any directory, no environment setup needed.
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
cd /d "%~dp0"
rem arm64 only: every phone from the last several years; halves the APK size.
call "%~dp0gradlew.bat" assembleRelease -PreactNativeArchitectures=arm64-v8a
if errorlevel 1 exit /b %errorlevel%

rem Version comes from the versionName line in app\build.gradle, e.g.  versionName "1.1"
set "VER="
for /f tokens^=2^ delims^=^" %%v in ('findstr /r /c:"^ *versionName" "%~dp0app\build.gradle"') do set "VER=%%v"
if not defined VER set "VER=unknown"

set "DIST=%~dp0..\..\dist"
if not exist "%DIST%" mkdir "%DIST%"
copy /y "%~dp0app\build\outputs\apk\release\app-release.apk" "%DIST%\HordeSurvival-%VER%.apk" >nul
echo.
echo APK copied to %DIST%\HordeSurvival-%VER%.apk
