## Downloads

- **macOS, Apple silicon (M1 and later):** `Polymine_VERSION_aarch64.dmg`
- **macOS, Intel:** `Polymine_VERSION_x64.dmg`
- **Windows:** `Polymine_VERSION_x64-setup.exe`
- **macOS, with Homebrew:** `brew install --cask uvw/tap/polymine`, which also
  puts `polymine-cli` on your `PATH`.
- **Windows, portable:** `Polymine_VERSION_x64_portable.zip`. Unzip anywhere and
  run `Polymine.exe`; settings and games stay in the `data` folder beside it.

`checksums.txt` lists each file's SHA-256, and each file carries a build
provenance attestation: `gh attestation verify <file> --repo uvw/polymine`.

## Opening an unsigned build

These builds aren't signed or notarized yet, so both systems warn on first
launch.

**macOS:** open the `.dmg` and drag Polymine to Applications. macOS then blocks
the first launch. Use one of these:

1. Try to open the app once, then go to **System Settings > Privacy & Security**
   and click **Open Anyway**.
2. In Terminal, run `xattr -dr com.apple.quarantine /Applications/Polymine.app`.
3. On macOS 14 or earlier, Control-click (or right-click) Polymine in
   Applications, choose **Open**, then **Open** again.

**Windows:** SmartScreen may show "Windows protected your PC". Click **More
info**, then **Run anyway**.

## Command line

`polymine-cli` comes with the app: next to `Polymine.exe` in the install folder
on Windows, and at `/Applications/Polymine.app/Contents/MacOS/polymine-cli` on
macOS. Run `polymine-cli skill` for the guide coding agents use.
