# To do

Open work and ideas, roughly by priority within each section. Delete an item
when it's done. When an item settles a question, record the choice in
[decisions.md](decisions.md) and delete the item.

## Next

1. **Tune Frost, Pride, and Spectrum** once the maintainer has played with them.
   Frost and Pride already got a measured pass; what's left is taste.
2. **TypeScript 7.** Dependabot ignores TypeScript majors until `svelte-check`
   supports TypeScript 7; lift the ignore in `.github/dependabot.yml` then.

## Look and feel

1. **`BitmapText` for cell numbers**, if text textures ever show up in profiles.
   PixiJS then draws every number from one shared glyph atlas instead of one
   texture per `Text` object. Huge boards (200 by 200) are where it would show
   first.
2. **One Dark Pro variant.** One Dark Pro also has a Darker flavor, with Vivid
   colors and italics; the theme may switch to it later.
3. **Ferrofluid cleanup.** Leaving the theme destroys textures its blur shaders
   still hold, and leaves those shaders and the quad geometry for Pixi's garbage
   collector; each round trip logs two binding warnings.

## Themes

Themes are folders of CSS variables (decision 35).
[How theming works](themes/how-theming-works.md) says where each of these plugs
in. No theme editor UI for now.

1. **Ferrofluid experiment.** Built as `--board-effects: ferrofluid` and the
   Ferrofluid theme, listed only in development builds (decision 40, and Board
   effects in `docs/themes/how-theming-works.md`). What's left:
   1. **The maintainer's calls:** whether it ships as a bundled theme and under
      what name; whether a hidden setting should let release builds pick it; and
      whether the camera's tilt, the spikes' lean, the flag spire, and the
      glowing digits are the look.
   2. **Performance off this machine:** a frame with the magnet up takes under 1
      ms on a high-end desktop GPU. Once a flag is up, every pixel marches 32
      steps through the spikes. On a slow GPU, the first fix is to march only
      the columns under flags and the magnet.
   3. **Large boards:** every change draws all of the field's cells again; a 200
      by 200 board's cost is unmeasured.
   4. **The game's end:** the maintainer's call on the splash's timing and size,
      all in `ui/src/lib/board/splash.ts`. The drop's shadow barely shows on
      dark plates.
2. **Outlines for every mark.** The flag has `--flag-outline` and the question
   mark `--question-outline`, which Glossy and Glass use under their glare.
   Swatch's dark question mark and flag pole still fade on dark accents such as
   Windows' Storm gray. Swatch could take a light `--question-outline`, and the
   pole needs an outline of its own. Item 2 under
   [Windows only](handoffs.md#windows-only) in the handoffs checks Swatch under
   Storm. The theme tests check the question mark only in the editor themes,
   since most other built-in themes miss 3:1 for it on the flat closed color.
3. **Window font and title bar tokens.** Editor themes want monospace window
   text and a title bar strip darker than the window, as code editors draw them.
   Today the chrome keeps the system font, and `--window` paints the toolbar and
   the board's background alike.
4. **Rounder cells.** `--cell-rounding` stops at 6 pixels, so Catppuccin Latte's
   puffy tiles look square on large cells. Open: a larger cap, or a separate
   variable for round cells.
5. **Theme checks under color vision deficiency.** The theme tests check digit
   contrast and the marks only in normal vision. Reds darken under protanopia,
   so many built-in themes have a digit under 4.5:1, or a mark under its bar,
   for at least one deficiency. The color filter fixes that for players who turn
   it on. Open: whether the theme tests should hold built-in themes to the
   filter's pairs without it, and whether to check milder severities, which need
   Machado's partial matrices.
6. **Gaps in the light on cells** (decision 44).
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

1. **Specta 2.** Move to specta 2 and `tauri-specta` 2 once they ship, and drop
   the exact version pins in `Cargo.toml` and `src-tauri/Cargo.toml`.
2. **A sturdier installer test.** A locked file in the `finally` block of
   `hack/windows-installer-test.ps1` stops the remaining restores. Wrap each
   restore on its own and print the backup path on any error.
3. **Tests for the docs that have none.** The `docs/CLI.md` tables, the
   `--timeout` floor, the player's guide's minimal theme, and the tiling table
   in `docs/design.md` can drift without a test failing.
