# Windows runbooks

## Summary

Testing the NSIS installer and building a release's Windows files by hand need a
Windows machine. Both need the Rust toolchain and Node.js from
[Prerequisites](../CONTRIBUTING.md#prerequisites) in CONTRIBUTING.md.

## Testing the installer

Run this after any change to the NSIS installer, its hooks in
`src-tauri/windows/hooks.nsh`, or where Polymine keeps its data:

```powershell
cargo build --release -p polymine-cli
New-Item -ItemType Directory -Force src-tauri/binaries
Copy-Item target/release/polymine-cli.exe src-tauri/binaries/polymine-cli-x86_64-pc-windows-msvc.exe
npx tauri build --bundles nsis --config src-tauri/tauri.bundle-cli.conf.json
cargo build -p polymine-cli
powershell -ExecutionPolicy Bypass -File hack/windows-installer-test.ps1 -ResetPlayerData
```

The script uninstalls Polymine and deletes its data on purpose, so it refuses to
run without `-ResetPlayerData`. It backs up `%APPDATA%\Polymine`, both
`dev.uvw.polymine` folders, and the user's `PATH` first. It restores them at the
end, whatever the outcome, and leaves the tested build installed. The header of
`hack/windows-installer-test.ps1` lists every check: install, quit, uninstall
with and without the data, and the uninstall an update runs.

1. The installer's hooks run `polymine-cli link` and `unlink` for the `PATH`,
   since NSIS strings stop at 1,024 characters and many `PATH`s are longer.
2. The script ticks the uninstaller's box and presses Uninstall through Win32
   messages, so it also runs over Remote Desktop.
3. The debug `polymine-cli` from the fifth command lets the script leave a game
   unfinished, so `game.json` gets checked too.
4. Makensis prints one warning, `LangString "choowHowToInstall" is not set`. It
   comes from Tauri's own NSIS template, not from Polymine's hooks.

## Building the release files on Windows

Releases come from the release workflow ([releasing.md](releasing.md)).
`hack/release-windows.ps1` makes the same Windows files on this machine, the
NSIS installer with `polymine-cli` bundled and the portable ZIP, to test them.
It publishes nothing: a local build records this machine's home folder in the
binaries, and nothing attests it.

```powershell
pwsh hack/release-windows.ps1
pwsh hack/release-windows.ps1 -Tag v0.0.3 -InstallerTest
```

1. `-Tag` checks the tag against every version file first.
2. `-InstallerTest` runs the installer test above on the new installer.
