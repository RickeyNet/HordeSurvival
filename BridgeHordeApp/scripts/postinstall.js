// npm postinstall, cross-platform.
// On Windows, fetch react-native-audio-api's Android binaries ourselves (its own
// bash download script fails there). On macOS/Linux (local Mac, EAS, CI) do
// nothing: the library's podspec downloads its iOS binaries during pod install,
// and Gradle's download task works natively.
const { execFileSync } = require("child_process");
const path = require("path");

if (process.platform === "win32") {
  execFileSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "setup-audio-binaries.ps1")],
    { stdio: "inherit" },
  );
}
