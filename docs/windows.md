# Windows runbooks

## Summary

Testing the NSIS installer and building a release's Windows files by hand need a
Windows machine. Both need the Rust toolchain and Node.js from the README's
[Building from source](../README.md#building-from-source) section.

## Testing the installer

Run this after any change to the NSIS installer, its hooks in
`src-tauri/windows/hooks.nsh`, or where Polymine keeps its data:

```powershell
cargo build --release -p polymine-cli
New-Item -ItemType Directory -Force src-tauri/binaries
Copy-Item target/release/polymine-cli.exe src-tauri/binaries/polymine-cli-x86_64-pc-windows-msvc.exe
npx tauri build --bundles nsis --config src-tauri/tauri.bundle-cli.conf.json
cargo build -p polymine-cli
powershell -ExecutionPolicy Bypass -File scripts/windows-installer-test.ps1 -ResetPlayerData
```

The script uninstalls Polymine and deletes its data on purpose, so it refuses to
run without `-ResetPlayerData`. It backs up `%APPDATA%\Polymine`, both
`dev.uvw.polymine` folders, and the user's `PATH` first. It restores them at the
end, whatever the outcome, and leaves the tested build installed. The header of
`scripts/windows-installer-test.ps1` lists every check: install, quit, uninstall
with and without the data, and the uninstall an update runs.

1. The installer's hooks run `polymine-cli link` and `unlink` for the `PATH`,
   since NSIS strings stop at 1,024 characters and many `PATH`s are longer.
2. The script ticks the uninstaller's box and presses Uninstall through Win32
   messages, so it also runs over Remote Desktop.
3. The debug `polymine-cli` from the fifth command lets the script leave a game
   unfinished, so `game.json` gets checked too.
4. Makensis prints one warning, `LangString "choowHowToInstall" is not set`. It
   comes from Tauri's own NSIS template, not from Polymine's hooks.

## Releasing from Windows

Releases come from the release workflow ([releasing.md](releasing.md)).
`scripts/release-windows.ps1` makes the same Windows files on this machine, the
NSIS installer with `polymine-cli` bundled and the portable ZIP, for testing
them. Don't publish them: a local build records this machine's home folder in
the binaries, and nothing attests it. Set the version in every manifest first;
the script checks the tag against them.

```powershell
pwsh scripts/release-windows.ps1 -Tag v0.0.3
pwsh scripts/release-windows.ps1 -Tag v0.0.3 -InstallerTest -Upload
```

1. Without `-Upload`, the script only builds.
2. `-InstallerTest` runs the installer test above before anything goes up.
3. `-Upload` creates the draft release for the tag if it's missing and attaches
   the files. Publish it on GitHub when it's ready.
