# To do

Open work and ideas, roughly by priority within each section. Delete an item
when it's done. When an item settles a question, record the choice in
[decisions.md](decisions.md) and delete the item.

## Next

1. **Tune Frost, Pride, and Spectrum** once the owner has played with them.
   Frost and Pride already got a measured pass; what's left is taste.
2. **The macOS Dock icon.** The window icon follows the theme on Windows and
   Linux only (decision 56). The Dock could follow it too, through
   `NSApplication.applicationIconImage` while the app runs.
3. **TypeScript 7.** Dependabot ignores TypeScript majors until `svelte-check`
   supports TypeScript 7; lift the ignore in `.github/dependabot.yml` then.
4. **A command that panics hangs the game.** A Tauri command that panics never
   answers, so `GameStore.run()` waits forever and every later click queues
   behind it. Catch the panic in the command layer, or time the call out.
5. **A pinned hint over the Paused card.** The hint's label stays on top when
   the game pauses.

## Gameplay and features

1. **Pentagon type 10**, Richard James's pentagon. The shape is settled: angles
   60, 150, 120, 120, and 90 degrees, sides 2, 1 − 1/√3, √3 − 1, 1 + 1/√3,
   and 2. The arrangement is open: 3-isohedral, not edge to edge, p2, six tiles
   to a cell. Find it, then check it for twins and run the autoplay example on
   it.
2. **Create Game mode.** Place mines by hand, then play or share the board.
   1. Builds on named saves: a created board saves as a config plus a mine list
      instead of a seed, so `SavedGame` needs a mines variant.
   2. An editing mode on the board: clicks toggle mines, the counter shows how
      many are placed, and a Play button starts the game.
   3. Created games count as custom, so they never reach the champions table.
   4. Open: whether the editor checks that the board can be solved without
      guessing, since the solver can already tell.
3. **Translations.** Every `<code>.json` beside `en.json` is a language, the
   Language setting picks one or follows the system, and missing keys fall back
   to English. What's left:
   1. The first translation, as a new JSON file with a `language.name` key.
   2. Plural forms need `Intl.PluralRules`; today's strings avoid plurals.
   3. Errors from the shell arrive in English. Translating them needs error
      codes in `AppError`, with the message built in the UI.
4. **Touch input.** Tap opens, a 450 ms long press flags, and two fingers pinch
   to zoom; none of it has run on a real touch screen yet. Still open:
   two-finger panning on boards bigger than the window, and bigger cells by
   default when the first input is touch.
5. **Remote leaderboard.** `polymine-cli sync --gist <id>` merges a history with
   a gist's, by record, in both directions. What's left:
   1. Sync from the app: a gist field and a Sync button in Settings. The app
      also syncs on start and after each finished game, so it sees merged games
      without a restart.
   2. Keep the token in the system keychain instead of an environment variable.
      Remote themes need the same for an optional GitHub token.
   3. Open: a private gist per player, or a shared one for friends, and how to
      keep a hand-edited gist from faking records.

6. **Remote themes.** Load custom themes from a GitHub repository or a gist by
   URL, as folders in the custom theme format. `crates/polymine-net` downloads a
   folder into a staging folder within caller limits. What's left:
   1. Depend on `polymine-net` from `src-tauri`, with a command that downloads
      into the theme folder's staging folder on a worker thread, checks the
      result with `polymine_ipc::themes::read_folder`, and moves it into place.
      Call `remove_partial_downloads` on the staging folder at startup.
   2. A setting that allows online features, checked before any request. Open:
      whether it starts off.
   3. Give the app a cache folder through `polymine_net::Cache`. An optional
      GitHub token goes in the keychain, as in item 5.
   4. Updates: store each theme's `Download::revision` and compare it with a
      fresh listing.
7. **Theme commands in the CLI.** A player can't run the built-in theme checks,
   so the guide lists the targets for a contrast checker instead.
   1. `polymine-cli theme check <folder>` runs the folder rules, the CSS parser,
      and the contrast and color-blind checks, and prints each miss.
   2. `polymine-cli theme use <id>` switches a running instance's theme, so an
      author can iterate without clicking through Settings.
   3. `log` and `paths` read the environment, so an instance started with
      `POLYMINE_DATA_DIR` needs the same variable in the CLI's shell. They could
      ask the running instance, as `status` already reports its log and data
      folder.

## Look and feel

1. **`BitmapText` for cell numbers**, if text textures ever show up in profiles.
   PixiJS then draws every number from one shared glyph atlas instead of one
   texture per `Text` object. Huge boards (200 by 200) are where it would show
   first.
2. **One Dark Pro variant.** The owner runs One Dark Darker with Vivid and
   italics and may switch the theme to that variant later.
3. **Ferrofluid cleanup.** Leaving the theme destroys textures its blur shaders
   still hold, and leaves those shaders and the quad geometry for Pixi's garbage
   collector; each round trip logs two binding warnings.

## Themes

Themes are folders of CSS variables (decision 36).
[How theming works](themes/how-theming-works.md) says where each of these plugs
in. No theme editor UI for now.

1. **Themed win and loss effects.** Particle style (confetti, sparks, or none),
   colors, count, and speed come from the theme, as new variables. The
   ferrofluid already replaces them with its own splash and ripples.
2. **Ferrofluid experiment.** Built as `--board-effects: ferrofluid` and the
   Ferrofluid theme, listed only in development builds (decision 41, and Board
   effects in `docs/themes/how-theming-works.md`). What's left:
   1. **The owner's calls:** whether it ships as a bundled theme and under what
      name; whether a hidden setting should let release builds pick it; and
      whether the camera's tilt, the spikes' lean, the flag spire, and the
      glowing digits are the look.
   2. **Performance off this machine:** a frame with the magnet up takes under 1
      ms on an RTX 4090. Once a flag is up, every pixel marches 32 steps through
      the spikes. On a slow GPU, the first fix is to march only the columns
      under flags and the magnet.
   3. **Large boards:** every change draws all of the field's cells again; a 200
      by 200 board's cost is unmeasured.
   4. **The game's end:** the owner's call on the splash's timing and size, all
      in `ui/src/lib/board/splash.ts`. The drop's shadow barely shows on dark
      plates.
3. **Effect stack.** The board renders into a texture, the theme's effects run
   over it in order as GPU shaders, and the result goes to the screen. PixiJS
   draws with WebGL2 (GLSL, translated to Metal on macOS and Direct3D 11 on
   Windows) and can switch to WebGPU, which adds compute shaders for
   simulations. A theme picks and tunes built-in effects with variables, such as
   `--board-effects: crt bloom` plus a variable per parameter; the ferrofluid
   above is the first effect.
   1. **Effects to try:** a CRT look (scanlines, barrel distortion, chromatic
      aberration, a rolling hum bar, noise, phosphor glow), neon bloom on
      numbers, a glitch burst on a loss, kaleidoscope folding, domain-warped
      plasma or marble behind the cells, moiré that shifts on hover, extruded or
      raymarched tiles in perspective that tilt toward the pointer, water
      ripples, reaction-diffusion growing across the open area, and sand that
      falls on a loss.
   2. **First themes:** a neon-noir CRT theme with an original name (not after a
      game's trademark), and a geometric, trippy one.
   3. **Desktop refraction experiment.** A shader sees only what the app draws,
      so refracting the desktop and windows behind Polymine needs a capture
      stream of what's under the window.
      1. **macOS:** ScreenCaptureKit streams the window's footprint with a
         filter that excludes Polymine's own window. The player grants Screen
         Recording, and macOS shows its capture indicator.
      2. **Windows:** Windows.Graphics.Capture on the monitor, with
         `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Polymine's window
         so the capture shows what's behind it.
      3. **Step one:** a quarter-resolution stream (about 30 MB/s at 30 fps)
         sent to the webview and uploaded as a WebGL texture, which Glass
         refracts through each dome with a small chromatic split. Measure the
         frame time and the lag while the window moves.
      4. **Step two, if the webview transfer chokes:** a native Metal or
         Direct3D layer under the transparent webview does the refraction with
         zero-copy capture frames.
      5. **Privacy:** frames stay in memory, never written or sent, and capture
         runs only while the window is visible and focused, behind an explicit
         opt-in.
4. **Outlines for every mark.** The flag has `--flag-outline` and the question
   mark `--question-outline`, which Glossy and Glass use under their glare.
   Swatch's dark question mark and flag pole still fade on dark accents such as
   Windows' Storm gray. Swatch could take a light `--question-outline`, and the
   pole needs an outline of its own. Item 3 under
   [Windows only](handoffs.md#windows-only) in the handoffs checks Swatch under
   Storm. The theme tests check the question mark only in the editor themes,
   since most other built-in themes miss 3:1 for it on the flat closed color.
5. **Window font and title bar tokens.** Editor themes want monospace window
   text and a title bar strip darker than the window, as code editors draw them.
   Today the chrome keeps the system font, and `--window` paints the toolbar and
   the board's background alike.
6. **Rounder cells.** `--cell-rounding` stops at 6 pixels, so Catppuccin Latte's
   puffy tiles look square on large cells. Open: a larger cap, or a separate
   variable for round cells.
7. **Refuse SVG references outside the file.** An `<image>` pointing elsewhere
   doesn't load, but Chromium draws a broken-picture box in its place. The
   folder check could refuse an `href` that doesn't start with `#`, past the
   namespace declarations.
8. **Theme checks under color vision deficiency.** The theme tests check digit
   contrast and the marks only in normal vision. Reds darken under protanopia,
   so many built-in themes have a digit under 4.5:1, or a mark under its bar,
   for at least one deficiency. The color filter fixes that for players who turn
   it on. Open: whether the theme tests should hold built-in themes to the
   filter's pairs without it, and whether to check milder severities, which need
   Machado's partial matrices.
9. **Gaps in the light on cells** (decision 45).
   1. Give Catppuccin Latte a darker `--flag-outline`, then count the flat sheen
      in the mark checks.
   2. Opacities can't follow light or dark mode, since `light-dark()` works only
      in colors. A theme that wants a gentler shade in one mode gives the shade
      a lighter color there, as Glossy does for its dark tiles.
   3. `colors` themes' count fills, the tiling thumbnails, and the rim light in
      the Settings previews stay flat.
   4. Pixi copies each cell's vertices into its batches, so Glossy's extra
      vertices cost 32 MB of heap on a 200 by 200 board. Instanced meshes per
      shape would share them.
   5. The entrance ripple moves every cell. On a 200 by 200 board, Glossy or
      not, it takes about 30 ms per frame at the median and over 2 s at the 95th
      percentile. A board that large could skip it.
   6. A shade on a see-through cell fades with it, since it mixes into the
      cell's fill at `--cell-closed-opacity`. Glass, at 10%, can't darken its
      edges visibly; a shade drawn as its own layer at its own opacity, as the
      glare and the rim are, would allow it.
   7. The Settings previews draw every layer opaque, so Frost and Glass show
      solid tiles, and Glass's white glare vanishes on its near-white closed
      color. Drawing the preview's cells at their opacities over a sample
      backdrop would show the glass.
   8. On small cells, an `arc` glare leaves a bright speck of a pixel or two at
      its far tip, in Glossy as well. It shows most on Glass, where the glare
      fades from 85% to 6% over a nearly clear cell. Cells about 40 pixels wide
      show it; cells three times larger don't.

## Platform and release

1. **Installers, code signing and auto-update.**
   1. Windows signing needs a code-signing certificate, or the Microsoft Store
      (item 2), which signs for us.
   2. macOS needs an Apple Developer ID and notarization for downloads to open
      without a warning. Today the bundle is ad-hoc signed.
   3. Auto-update through `tauri-plugin-updater`, with a signed update manifest
      attached to each release.
2. **Microsoft Store, winget, and MSIX.** The Store signs the build, so Windows
   shows no SmartScreen prompt and no certificate is needed. winget can point at
   the GitHub release files. Both take the NSIS `.exe` (decision 55), so neither
   needs an MSI. MSIX, the Store's own format, gives a sandboxed install, a
   clean uninstall, and Store updates. First check what it does to the CLI on
   `PATH`, the data folder, and the named pipe. If an MSI is ever wanted, a WiX
   fragment through `bundle.windows.wix.fragmentPaths` matches the NSIS hooks.
   It needs an `<Environment>` element for `PATH` and the Util extension's
   `RemoveFolderEx` for the player's data.
3. **A browser build.** The engine compiles to WASM, and the UI already talks
   only through `api.ts`, so a web build swaps the Tauri commands for direct
   engine calls. Open: where settings and history live (IndexedDB), and whether
   the CLI has any role there.
4. **Specta 2.** Move to specta 2 and `tauri-specta` 2 once they ship, and drop
   the exact version pins in `Cargo.toml` and `src-tauri/Cargo.toml`.
5. **Windows file checks for theme folders.** `same_file` in
   `crates/polymine-ipc/src/themes.rs` always passes on Windows, and a hard link
   to a file outside the folder reads fine. Open with
   `FILE_FLAG_OPEN_REPARSE_POINT` and compare file IDs.
6. **A sturdier installer test.** A locked file in the `finally` block of
   `scripts/windows-installer-test.ps1` stops the remaining restores. Wrap each
   restore on its own and print the backup path on any error.
7. **Tests for the docs that have none.** The `docs/CLI.md` tables, the
   `--timeout` floor, the player's guide's minimal theme, and the tiling table
   in `docs/design.md` can drift without a test failing.
