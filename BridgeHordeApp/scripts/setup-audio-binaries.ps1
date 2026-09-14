# Fetches react-native-audio-api's prebuilt Android binaries.
# Its own download script assumes Unix tools and fails on Windows, so we do it
# here (runs automatically via npm postinstall; skips work if already present).
$ErrorActionPreference = "Stop"
$pkg = Join-Path $PSScriptRoot "..\node_modules\react-native-audio-api"
if (-not (Test-Path $pkg)) { Write-Output "react-native-audio-api not installed; skipping"; exit 0 }

$base = "https://github.com/software-mansion-labs/rn-audio-libs/releases/download/v3.1.0"
$external = Join-Path $pkg "common\cpp\audioapi\external"
$jniDest = Join-Path $pkg "android\src\main"
$tmp = Join-Path $env:TEMP "audioapi-binaries"
New-Item -ItemType Directory -Force $tmp | Out-Null

if (-not (Test-Path (Join-Path $external "android"))) {
    Write-Output "Downloading android.zip..."
    Invoke-WebRequest "$base/android.zip" -OutFile "$tmp\android.zip"
    Expand-Archive "$tmp\android.zip" -DestinationPath $external -Force
}
if (-not (Test-Path (Join-Path $jniDest "jniLibs"))) {
    Write-Output "Downloading jniLibs.zip..."
    Invoke-WebRequest "$base/jniLibs.zip" -OutFile "$tmp\jniLibs.zip"
    Expand-Archive "$tmp\jniLibs.zip" -DestinationPath $jniDest -Force
}
# Empty placeholders so the library's own script skips iOS/macOS downloads.
foreach ($d in "ffmpeg_ios", "iphoneos", "iphonesimulator", "macosx") {
    New-Item -ItemType Directory -Force (Join-Path $external $d) | Out-Null
}
Write-Output "Audio binaries ready."
