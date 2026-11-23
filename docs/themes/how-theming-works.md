# How theming works

## Summary

A theme is a folder with a `theme.css` of CSS custom properties, plus optional
SVG glyphs and a `preview.png`. The built-in themes ship as folders in
`ui/src/themes`, and players add folders to the `themes` folder in their data
folder. Both kinds go through the same parser and resolver, so a player's theme
can do anything a built-in one does. They differ only in where the files come
from and in the `Relaxed:` header line, which only built-in themes use.

Settings shows every theme's name, description, and author from its header, so
theme names aren't translated. [Themes](../design.md#themes) in the design doc
lists the built-in themes.

The board is drawn on a canvas, so CSS never styles it directly. The UI resolves
each variable to a value and hands the renderer a plain `BoardTheme`. Window
chrome is CSS, so the theme's chrome tokens become inline properties on
`<html>`. No theme file is ever added to the page as a stylesheet.

This document covers the code. [Creating a theme](creating-a-theme.md) is the
player's guide, with every variable, its default, and the limits.

## Contents

- [Theme folders](#theme-folders)
- [Loading](#loading)
  - [Built-in themes](#built-in-themes)
  - [Player themes](#player-themes)
- [Validation and limits](#validation-and-limits)
  - [The folder, in Rust](#the-folder-in-rust)
  - [The CSS, in the UI](#the-css-in-the-ui)
- [Resolving variables](#resolving-variables)
- [From variables to pixels](#from-variables-to-pixels)
  - [Color-only counts](#color-only-counts)
  - [Light on cells](#light-on-cells)
- [Board effects](#board-effects)
  - [The ferrofluid](#the-ferrofluid)
  - [Tuning the ferrofluid](#tuning-the-ferrofluid)
- [Window chrome](#window-chrome)
- [SVG glyphs](#svg-glyphs)
- [Color filters](#color-filters)
  - [Pairs and bars](#pairs-and-bars)
  - [The solver](#the-solver)
  - [Filtered glyphs](#filtered-glyphs)
  - [Limits](#limits)
- [The format version](#the-format-version)
- [Tests](#tests)
- [Extending themes](#extending-themes)
  - [Adding a built-in theme](#adding-a-built-in-theme)
  - [Adding an editor theme](#adding-an-editor-theme)
  - [Adding a number style](#adding-a-number-style)
  - [Changing the color filter](#changing-the-color-filter)
  - [Adding a variable or a chrome token](#adding-a-variable-or-a-chrome-token)
- [Downloaded themes](#downloaded-themes)

## Theme folders

| Kind     | Folder                       | Read by                                        |
| -------- | ---------------------------- | ---------------------------------------------- |
| Built-in | `ui/src/themes/<id>/`        | Vite at build time, in `lib/themes/builtin.ts` |
| Player   | `<data folder>/themes/<id>/` | `polymine_ipc::themes`, through Tauri commands |

The data folder is the instance's, as `crates/polymine-ipc/src/instance.rs`
resolves it. [Data and runtime folders](../design.md#data-and-runtime-folders)
lists where that is for the default instance, a named one, and a portable copy.
`polymine-cli paths` prints the themes folder as `themes`.

The folder name is the theme's id, and a built-in id wins: a player folder named
`frost` is skipped. Settings stores the id. An id with no theme falls back to
Frost without changing the setting, so a theme that comes back is picked up
again.

`RENAMED_BUILT_INS` in `builtin.ts` maps the ids built-in themes had before a
rename to their current ids, such as `velvet` to `dracula`. `findTheme` in
`catalog.ts` follows it, so an old setting opens the renamed theme. A player
folder with an old id is skipped like one with a built-in id.

## Loading

### Built-in themes

`builtin.ts` reads `../../themes/*/theme.css` with `import.meta.glob` and
`?raw`, the SVG files the same way, and `preview.png` as a URL. Everything is
eager, so `BUILT_IN_THEMES` in `catalog.ts` exists at startup.

1. `BUILT_IN_ORDER` sets the order in Settings. Frost is first and is the
   default.
2. `EDITOR_COLUMNS` lists the Code section's columns as dark and light pairs.
3. `editorPlacement` gives each editor card its row and column, so each light
   theme sits under its dark one, and `EDITOR_ORDER` lists them in reading
   order. `EDITOR_THEMES` is the same list as a set.
4. `THEME_GRID_COLUMNS` is the grid's width, five columns.

`ui/src/themes` holds every built-in folder, experiments included.
`EXPERIMENTAL_THEMES` in `builtin.ts` names the experiments, such as Ferrofluid.
`BUILT_IN_THEMES` lists them only in development builds and in release builds
made with `VITE_EXPERIMENTS=1`, after the rest. The checks in `themes.test.ts`
and `filter.test.ts` skip them.

Vitest blanks CSS files unless told otherwise, so `vite.config.ts` lets
`ui/src/themes` through with `test.css.include`.

### Player themes

`src-tauri/src/themes.rs` has three commands, typed through `tauri-specta` and
called only from `ui/src/lib/api.ts`:

1. `list_themes` checks every folder and returns each usable theme's
   `theme.css`, its `preview.png` as a `data:` URL, and the names of its glyph
   files. It checks the glyph files' names and sizes without reading them.
   Folders that fail come back in `skipped` with a reason, and each reason is
   logged once.
2. `read_theme(id)` returns one theme with its SVG text, and checks the SVG
   files as it reads them. The UI asks only for the chosen theme's glyphs.
3. `open_themes_folder` creates the folder and opens it with `open`, `explorer`,
   or `xdg-open`.

`ThemeLibrary` in `lib/themes/library.svelte.ts` calls them at startup, when
Settings opens, and whenever the window comes to the front. An entry whose files
didn't change keeps its object, so nothing redraws, and the resolved themes stay
cached.

## Validation and limits

Two layers check a player theme. Rust checks the folder and the files; the UI
checks `theme.css`. Built-in themes skip the Rust layer and must pass the UI's.

### The folder, in Rust

`crates/polymine-ipc/src/themes.rs` has no Tauri dependency, so a download can
use it too.

1. Only the names in `allowed_files()` may appear, matched exactly: `theme.css`,
   `preview.png`, `mine.svg`, `flag.svg`, `question.svg`, `1.svg` to `14.svg`,
   and four doc files the app never reads. Hidden entries and the files Windows
   leaves are ignored, which keeps a download's staging folder out of the list.
2. Links and subfolders are refused. Entries are inspected with
   `symlink_metadata`, and a file with more than one hard link is refused when
   it's read. On Unix the opened file must have the device and inode that were
   listed. Windows opens a link as itself rather than following it, and checks
   the size and write time against the listing. Either way, a file swapped for a
   link mid-read is caught.
3. Each file is read through `take(limit + 1)`, so a file that grows after it's
   listed is still capped. The limits are the `MAX_*` constants at the top of
   the module, and [Creating a theme](creating-a-theme.md#limits) lists them.
4. `read_theme(dir, id)` accepts only a valid id: 1 to 40 lowercase letters,
   digits, or hyphens, starting with a letter or a digit. A path therefore can't
   climb out of the themes folder.
5. `theme.css` must not contain `url(`, `@import`, or a backslash anywhere, in
   any letter case. `check_css` reads the whole file, comments and the header
   included. SVG files must contain `<svg` and none of `<script`,
   `<foreignObject`, `<!DOCTYPE`, `<!ENTITY`, or `javascript:`. These rules
   repeat the UI's where they matter most, so nothing that could fetch reaches
   the webview.

### The CSS, in the UI

`parseThemeCss` in `lib/themes/format.ts` checks the following and throws a
`ThemeError` whose message goes to the log and to Settings:

1. A header comment comes first, with `Name`, `Author`, `Description`, and
   `Version`, each within a length limit, and `Format`, a whole number of 1 or
   more. `Relaxed` is read only for built-in themes, and other lines are
   ignored.
2. Exactly one `:root { … }` rule follows, holding only custom properties.
   `--system-accent` can't be declared; Polymine sets it.
3. Values may call only the functions in `FUNCTIONS`: color functions,
   `color-mix()`, `light-dark()`, `var()`, `calc()`, `min()`, `max()`,
   `clamp()`, and gradients. That rules out `url()`, `image-set()`, `src()`,
   `attr()`, and `env()`, which could load or leak something.
4. Values may not contain `@`, braces, `<`, `>`, `!`, or a backslash, and
   strings must close. Whitespace runs collapse to one space.

A value that parses but doesn't fit its variable, such as `--board-gap: 3em`,
doesn't skip the theme. The resolver warns and uses the default.

## Resolving variables

`resolveTheme` in `lib/themes/resolve.ts` turns a parsed sheet into a `Theme`
for a `ThemeEnv`. The environment holds the accent color, or null when there is
none or the player turned the tint off, and whether the system is in dark mode.

1. **Defaults.** The theme's declarations sit over `VARIABLES` in `format.ts`,
   which hold Graphite's values without the accent tint. Number colors come all
   from the theme when it sets `--number-1`, and all from `DEFAULT_NUMBERS` when
   it doesn't.
2. **Scheme.** `--color-scheme` decides whether `light-dark()` resolves light or
   dark: the system's mode for `light dark`, or the fixed one.
3. **Values that aren't colors.** Keywords, opacities, shares, lengths, spike
   counts, weights, and fonts are read in TypeScript after `substitute` in
   `css.ts` fills in `var()`. They take plain values, not `calc()`.
4. **Colors.** `browserColors` reads what it can itself with `staticColors`:
   hex, `rgb()`, `color(srgb …)`, `transparent`, `black`, `white`,
   `light-dark()`, and `color-mix(in srgb, …)`, with `var()` and
   `--system-accent` filled in. That covers every built-in theme exactly, with
   the same code the tests run. Anything else, such as `oklch()`, named colors,
   or `color-mix(in oklab, …)`, goes to `domColors`.
5. **The hidden element.** `domColors` puts the declarations and
   `--system-accent` on an element inside a hidden, empty `about:blank` frame.
   It sets `color-scheme` on the element and reads each variable's computed
   `color` from a child probe. The frame keeps the app's tokens and stylesheet
   out of reach, so a theme sees only its own variables, as on the static path.
   It also keeps the stylesheet's Reduce Motion transitions from delaying a
   read. A probe that keeps its parent's sentinel color means the variable isn't
   a color. A computed color in a space `css.ts` doesn't parse is painted to a
   one-pixel canvas and read back as sRGB.
6. **Fallbacks.** A color that doesn't resolve takes its default, and one with
   alpha loses it, except `--cell-sheen`. Each problem is logged once through
   `warnOnce` in `catalog.ts`, as `theme <id>: …`.

`defaultColors()` uses `browserColors` when the browser resolves a test mix on
the hidden element, and `staticColors` otherwise, as in jsdom. `themeFor` in
`catalog.ts` caches each entry's `Theme` per accent and mode, so redrawing costs
nothing.

The static path keeps the built-in themes exact, because the browser rounds.
Chrome stores the alpha of an `rgb()` color in 8 bits, so 4.5% comes back as
4.3%. It also prints `color(srgb …)` channels to six digits, which flips a mix
that lands on .5. `evaluateColor` snaps those channels to a thousandth of a
level, so the browser's colors round as `mix()` in `color.ts` does.

## From variables to pixels

`GameStore.theme` in `lib/game.svelte.ts` resolves the chosen entry for the
current accent, tint setting, and system mode. It then passes the result through
the player's [color filter](#color-filters). `BoardCanvas.svelte` passes
`theme.board` to `BoardView.setTheme`, which rebuilds the cached shapes.

| Variable                                          | `BoardTheme` field                 | Drawn as                                                     |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `--board-plate`, `--board-plate-opacity`          | `plate`, `plateAlpha`              | The tray in `BoardCanvas.svelte`; `none` is `null`, no tray  |
| `--board-gap`, `--cell-rounding`, `--cell-bevel`  | `gap`, `rounding`, `bevel`         | Cell outlines and the sheen inset in `BoardView.shapeFor`    |
| `--cell-closed`, `-hover`, `-pressed`, `-edge`    | `closed`, `closedHover`, …         | Closed fills, at `closedAlpha`; hover adds 0.12; edge × 0.9  |
| `--cell-closed-opacity`                           | `closedAlpha`                      | The closed layer's opacity                                   |
| `--cell-sheen`                                    | `sheen`, `sheenAlpha`              | The raised highlight on closed cells                         |
| `--cell-open`, `--cell-open-edge`, `-opacity`     | `open`, `openEdge`, `openAlpha`    | Open fills and edges                                         |
| `--cell-exploded`                                 | `exploded`                         | The opened mine's cell, the wrong-flag cross, the blast glow |
| `--flag`, `--flag-outline`, `--flag-pole`         | `flag`, `flagOutline`, `flagPole`  | The drawn flag; `flag` also rings a flag hint                |
| `--question`, `--mine`, `--mine-spark`, `-spikes` | `question`, `mine`, `mineSpark`, … | The question mark and the drawn mine                         |
| `--question-outline`                              | `questionOutline`                  | An edge on the question mark; `none` is `null`               |
| `--hint`, `--focus`, `--win`                      | `hint`, `focus`, `win`             | Hint and focus rings, the win glow and confetti              |
| `--number-1` to `--number-14`                     | `numbers`                          | Digits, or fills and the key for `colors`                    |
| `--number-style`                                  | `numberStyle`                      | `digits` or `colors`                                         |
| `--number-ring-from`                              | `numberRingFrom`                   | Rings instead of fills from this count up, for `colors`      |
| `--board-font`, `--board-font-weight`             | `fontFamily`, `fontWeight`         | Pixi `Text` for digits and the question mark                 |
| `--number-shadow`, `-opacity`                     | `numberShadow`, …                  | A Pixi drop shadow on digits, cast away from the light       |
| `--cell-light-angle`                              | `lightAngle`                       | The direction every layer of light runs                      |
| `--cell-gloss`, `-opacity`, `-fade`, `-extent`    | `gloss`, `glossAlpha`, …           | The glare on closed cells                                    |
| `--cell-gloss-shape`, `--cell-glint-opacity`      | `glossShape`, `glintAlpha`         | The glare's outline, and the hover glint                     |
| `--cell-rim`, `-opacity`, `-width`, `-angle`      | `rim`, `rimAlpha`, …               | The rim light inside closed cells' edges                     |
| `--cell-shade`, `-opacity`, `-depth`              | `shade`, `shadeAlpha`, …           | Mixed into closed cells' fills, away from the light          |
| `--cell-open-shade`, `-opacity`                   | `openShade`, `openShadeAlpha`      | Mixed into open and pressed cells' fills                     |
| SVG files                                         | `glyphs`                           | Sprites in place of drawn glyphs                             |

The rest of the `Theme` comes from the same resolve:

1. `--color-scheme` and `--window-material` become `Theme.scheme` and
   `Theme.material`, and the chrome tokens become `Theme.chrome`.
2. The `--icon-*` variables become `Theme.icon`. `icon.ts` draws the window icon
   from it and the board.
3. `TilingThumb.svelte` and the Settings previews read the same `BoardTheme`.
   The thumbnail's edge color comes from `thumbEdge` in `thumb.ts`.
4. The Settings previews resolve with the accent while the dialog's tint switch
   is on, so a theme that fills cells with `--system-accent`, as Swatch does,
   previews as it plays. They go through the dialog's color filter too.

### Color-only counts

`lib/themes/counts.ts` decides how a `colors` theme shows a count, for the board
and the key alike. `countSwatch` gives a count its color and says whether it's a
ring; a count past the end of the list takes the last color. `countKey` lists
the looks of counts 1 to the board's highest, merging neighbors that look alike
into a range such as 8–14.

1. `BoardView.countFill` fills the cell's outline. For a ring, it cuts a hole of
   the same shape with Pixi's `cut()`, inset by `RING_BAND` (0.42) of the
   inradius. Each shape, color, and ring share one `GraphicsContext`.
2. `BoardView` tracks the cell under the pointer and the keyboard focus,
   whichever moved last. It reports that cell's count through
   `handlers.inspect`, or null while the board is locked. That cell shows its
   count as a digit in black or white, whichever reads better on the fill. On a
   ring the digit takes an edge in the open cell's color.
3. `BoardCanvas.svelte` shrinks the board's host by a strip, so cells never sit
   under the key, and draws the key there. It has one chip per look, up to the
   most neighbors a cell has on this board. The inspected count's chip grows and
   takes the theme's focus color, and the rest dim. The key is hidden from
   screen readers, which hear each count as the focus reaches it.

### Light on cells

The light variables lay layers across each cell along one direction, from the
edge facing the light to the far edge. `lib/themes/gloss.ts` holds them as
profiles of that distance, from 0 to 1:

1. The shade, mixed into a raised or a recessed cell's color, with `bodyAt`.
2. The glare, with `glossAt`.
3. The rim light, with `rimAt`.

The renderer draws the profiles, and the theme tests and the color filter
measure them.

`LightAtlas` in `lib/board/light.ts` writes every profile the theme needs into
one texture, 256 texels wide with four texel rows each: the closed, hovered,
pressed, open, and exploded bodies, the glare, and the rim light. `style()`
returns a texture fill with a matrix that lays one row across a shape. Along x
it runs from the shape's lit edge to its far edge. Along y it barely moves, so
the matrix stays invertible while every point samples the middle of its row. The
fill uses `textureSpace: "global"`, which for a drawing without a transform is
the cell's own pixels. Pixi turns any texture fill that isn't a `FillGradient`
to repeat wrapping, so the first and last texels of a row pad its ends.

1. `BoardView.context` fills a shaded cell with its body row instead of a flat
   color, so the shade adds no vertices. A pressed cell takes the open cells'
   shade.
2. `BoardView.shapeFor` builds each shape's glare once with `glareOutline`. The
   glare is the cell inset by its bevel, cut by a half plane for `band` or a
   circle for `arc` and `spot`, with `intersectConvex` from
   `lib/board/geometry.ts`. Every cell in every tiling is convex. Each corner
   remembers where it came from, so the cell's own corners keep their rounding
   and the cut stays sharp. A `spot` fills with one radial `FillGradient`, which
   Pixi fits to each glare's bounds.
3. The rim light is a stroke on the outline inset by half its width, with the
   rim row laid along `--cell-rim-angle`.
4. Every cell drawing sets `batchMode = "batch"`. Pixi otherwise draws a drawing
   of 200 or more vertices on its own, one draw call per cell.
5. `BoardView.moveGlint` redraws one small `Graphics` in the overlay each frame
   while the glint runs: a slanted band clipped to the cell's sheen outline.
6. Digits get a Pixi `dropShadow`, drawn into each text's texture once.
7. The Settings previews draw the same light as CSS gradients from the resolved
   numbers, through `previewLight`, never from the theme's CSS.

One texture keeps every cell in the same batches. A WebGL batch holds 16
textures, and the digits' text textures already take most of them, so a texture
per layer would split the board into more draw calls.

With every layer on, a closed cell takes 123 vertices to Graphite's 68. On a 200
by 200 board, measured on a Mac on 2026-11-03 against Graphite:

| Measure                      | Every layer on | Graphite   |
| ---------------------------- | -------------- | ---------- |
| Theme switch                 | 430–476 ms     | 414–455 ms |
| Hover frame, median          | 4.5 ms         | 4.7 ms     |
| Hover frame, 95th percentile | 12.6 ms        | 10.7 ms    |
| Entrance frame               | 36 ms          | 27 ms      |
| Draw calls per frame         | 676            | 631        |
| JS heap                      | 394 MB         | 362 MB     |

Pixi copies each cell's vertices into its batches, which is where the heap
grows.

`backdropLooks` lists every color a mark can sit on: a cell's body at both ends
of its shade and, for a closed cell, each of those under the glare at its
brightest and its faintest. A `Look` is a stack of layers as one affine map per
8-bit channel, `channel × keep + add`, so the filter can apply it to a color it
moves. The flat sheen stays out, as it does in the theme tests.

## Board effects

`--board-effects` is a list of effect names from `BOARD_EFFECTS` in
`lib/themes/format.ts`, parsed into `BoardTheme.effects`. A theme can only pick
effects; their shaders live in `lib/board`
([decision 40](../decisions.md#40-themes-never-carry-shader-code)).

### The ferrofluid

`ferrofluid`, in `lib/board/ferrofluid.ts`, is the only effect so far, with its
shaders in `ferrofluid.glsl.ts`. Closed cells become a pool of glossy black
fluid, and open cells keep the theme's drawing as drained plates.

`BoardView.layoutFluid` starts `Ferrofluid` when the effects include
`ferrofluid` and hides the drawings of closed cells. The fluid's surface lies
over the open cells' plates, and the glyphs move to a layer of their own above
it. Spikes stand over the plates above them, and digits stay on top of the
fluid. `drawShape` tells the effect each cell's state: `full`, `pressed`,
`flagged`, or `drained`. `drawGlyph` leaves out the flag, which becomes a spike,
and gives digits a glow in their own color instead of the theme's shadow. The
effect reads these variables:

| Variable             | What the fluid does with it                 |
| -------------------- | ------------------------------------------- |
| `--cell-closed`      | The fluid's own color                       |
| `--cell-gloss`       | Its highlights: the softbox and the strip   |
| `--cell-rim`         | The light at grazing angles and the horizon |
| `--flag`             | The glow on a flag's tip                    |
| `--cell-light-angle` | Where the softbox sits                      |

1. **The field.** Every closed cell's outline is drawn once into a field
   texture. Its red channel holds the cell's fluid level, green a seed for a
   flag's spike, and blue a seed for the cell's own spike. The field is then
   blurred twice, across and down. The fluid lies flat and calm, and rounds down
   only where it meets a drained cell. The field is half float, at the
   resolution that makes the blur's sigma six texels. It's drawn again only when
   a cell, the pan, or the layout changes.
2. **The surface.** One mesh covering the board reads the field as a height map.
   It filters the field with a cubic B-spline over 4 by 4 texels, weighed in
   full float, since hardware filtering's 8-bit weights step a magnified slope
   into facets. The edge's slope comes from the spline's own derivative.
3. **The needles.** A magnet springs after the pointer, or the keyboard focus.
   Each closed cell within `REACH` of it grows a needle from its center:
   1. The needle is a power of the cell's blurred seed, scaled by the magnet's
      pull at its foot, up to `HEIGHT.spike` right under the magnet. Cells
      farther off stay flat.
   2. Each needle shears toward the magnet, upright right under it and up to
      `LEAN` of its height sideways farther out.
   3. It also shears against the magnet's velocity, so needles trail a fast
      pointer and swing back.
   4. A flag's spike is a higher power of its own seed and stands whether the
      magnet is near or not.
4. **The camera.** The camera looks down with a slight tilt, so tall spikes
   stand up the screen. The shader marches each pixel's ray through the spikes
   to find what it sees.
5. **The light.** The fluid is lit as a black mirror. A softbox sits where the
   theme's light is, and a wide strip behind the camera lines the front of every
   spike. A faint horizon takes the rim color, and the calm fluid mirrors a dim
   window overhead. Shading takes a camera over the board's middle, so flat
   fluid mirrors a different part of the room at each point. A needle's steep
   flank would mirror only the black pool, so the flank on the light's side gets
   an edge light of its own. A flag's spike glows in the flag color, white-hot
   at its tip, and lights the fluid around its foot.
6. **Smooth edges.** Where a spike's outline or a sharp highlight crosses a 2 by
   2 group of pixels, each pixel is shaded again at four points of a rotated
   grid and averaged. Edges come out smooth, and flat fluid costs one sample.
7. **The game's end.** The effect takes the place of the sparks, the glow, and
   the confetti:
   1. A loss throws every spike up and lets them slump back with a wobble, while
      three quick, damped rings leave the mine.
   2. A win drops a droplet into the middle, ray-marched as a sphere with a
      shadow under it. The droplet punches a crater that rebounds into a jet,
      throws up a crown of 14 spikes, and sends a slow ring out.
   3. The ring leaves a film on every cell it crosses. It comes back off the
      board's edges as if from the middle's mirror images, and each digit swells
      as the ring crests under it. The film drains from the middle out after
      about 2 seconds.
   4. Reduced motion jumps the magnet, drains cells at once, and skips both
      ends, leaving the final board.

Measured on 2026-11-04 on a Windows machine with a high-end desktop GPU, in
WebView2, at 1000 by 700: a frame with the magnet up takes under 1 ms, and
drawing the field again takes 0.13 ms.

### Tuning the ferrofluid

Constants in the code set the look, not theme variables. Lengths are in inradii,
the distance from a cell's center to its nearest edge, so the effect scales with
the cells.

The needles, in `ferrofluid.glsl.ts` and `ferrofluid.ts`:

| Constant       | Value   | What it changes                                                                    |
| -------------- | ------- | ---------------------------------------------------------------------------------- |
| `HEIGHT.spike` | 4.2     | A needle's height right under the pointer                                          |
| `REACH`        | 2.6     | How far the pointer's pull reaches; cells beyond it lie flat                       |
| `CELL_POWER`   | 9       | How thin a needle is; lower values widen its base until it swallows the cell       |
| `LEAN`         | 0.95    | How far a needle leans toward the pointer, per unit of its height, at the far edge |
| `WHIP`         | 0.0014  | How far needles trail a moving pointer, per pixel a second of its speed            |
| `MOST_LEAN`    | 1.4     | The most a needle leans, from both together                                        |
| `FOLLOW`       | 140, 15 | The spring that carries the pull after the pointer: stiffness, then damping        |
| `PULL`         | 70, 7.5 | The spring that raises and lowers the needles as the pointer arrives and leaves    |
| `TILT`         | 0.45    | The camera's tilt: how far up the screen a point shows per pixel of its height     |

The surface, the flags, and the digits:

| Constant           | Value | What it changes                                                                                                         |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `HEIGHT.edge`      | 0.6   | The rounded lip where the fluid meets a drained cell                                                                    |
| `HEIGHT.flag`      | 2.6   | A flag's spike                                                                                                          |
| `FLAG_POWER`       | 10    | How thin a flag's spike is                                                                                              |
| `FIELD_INSET`      | 0.16  | How far each cell's fluid pulls in from its outline                                                                     |
| `FIELD_BLUR`       | 0.34  | How soft the fluid's edges are                                                                                          |
| `FOCAL`            | 1.4   | The shading camera's distance, as a share of the window's larger side                                                   |
| `0.07 * window`    | 0.07  | How strongly the calm fluid mirrors the window overhead                                                                 |
| `1.1 * flank`      | 1.1   | The white streak down the lit side of each needle                                                                       |
| `0.32 * pow(near…` | 0.32  | The pool of flag-colored light around a flag's foot                                                                     |
| `FLARE`            | 0.45  | How much a digit swells as a win's ring passes, in `BoardView.ts`                                                       |
| `SHARP`            | 0.12  | How sharp a change in brightness between neighboring pixels must be before they are shaded four times over to smooth it |

The game's end lives in `splash.ts`: `WIN` sets the droplet, crater, crown, jet,
ring, and flood, and `LOSS` sets the ripples. In `ferrofluid.ts`, `BURST_KICK`
and `SURGE` set how hard a loss throws every needle up and how it wobbles back.

## Window chrome

`CHROME_TOKENS` in `format.ts` lists the 22 tokens from `app.css` a theme may
set, and Midnight sets all of them. `--window-image` and `--accent-image` carry
its background glow and its gradient button. `app.css` reads both through a
`var()` fallback, so a theme that sets neither keeps `app.css`'s look.

`chromeStyle` in `lib/themes/accent.ts` returns every property the theme and the
accent control, with null for those `app.css` should supply. `App.svelte` sets
or removes each one on `<html>`:

1. The theme's chrome tokens, with its own helper variables filled in.
   References to other tokens and to `--system-accent` stay for the browser.
2. The system accent's `--accent`, `--accent-hover`, and `--on-accent`, when the
   tint is on and the theme sets no `--accent`.
3. `--system-accent` itself, while the tint is on.
4. `color-scheme`, when the theme fixes the mode.

`App.svelte` also sets `data-material` on `<html>` and asks the shell for the
frosted material when the theme wants it. With `none`, the default material
stays behind the window and `app.css` paints the window opaque over it.

## SVG glyphs

`svgGlyph` in `lib/themes/entry.ts` turns SVG text into a `data:` URL and an
aspect ratio from the `viewBox`, or from `width` and `height`. `GlyphTextures`
in `lib/board/glyphs.ts` loads each URL once as an `Image`. An SVG loaded as an
image runs no scripts and loads no external resources, which is why the board
never puts theme SVG into the DOM. Each glyph is drawn to a canvas at the size
and pixel density a cell needs and becomes a Pixi texture through
`CanvasSource`. Textures are freed whenever the board rebuilds, and the decoded
images stay.

`BoardView.drawGlyph` uses the glyph once its texture is ready, sized to fit a
square `SVG_GLYPH_SIZE` (1.3) inradii wide. Until then it draws its own glyph.
When an image finishes loading, the view draws every glyph again. A number's SVG
replaces the digit, and in a `colors` theme it sits on the fill.

## Color filters

The Color filter setting in Themes remaps the board's colors for deuteranopia,
protanopia, or tritanopia. It runs after resolution, in `lib/themes/filter.ts`,
so it works on every theme, built-in or not, and no theme needs tuning of its
own. `filterTheme` returns the theme unchanged for `off`. Otherwise it returns a
copy whose board went through `filterBoard`, with `BoardTheme.filter` naming the
filter.

### Pairs and bars

`filterBoard` checks the colors a player must tell apart as pairs, each with a
bar. The bars are the theme tests' own.

| Pair                                                           | Measure    | Bar                             |
| -------------------------------------------------------------- | ---------- | ------------------------------- |
| Every two count colors                                         | `distance` | 2.5 for digits, 10 for `colors` |
| A digit on an open cell                                        | contrast   | 4.5:1                           |
| A `colors` count's fill on an open cell, and on a closed one   | `distance` | 10                              |
| Closed and open cells                                          | contrast   | 3:1                             |
| The flag on a closed cell, by its fill or its outline          | contrast   | 3:1                             |
| `?` on a closed cell, the mine on its blast, the spark on open | contrast   | 3:1                             |
| The hint and flag rings, and a blast and an open cell          | `distance` | 10                              |

Pairs that put a mark on a cell, and the pair of closed and open cells, are
measured on every color the cell's shade and glare can put there, from
[Light on cells](#light-on-cells). The worst one counts. The solver then steps
the cell's base color through that look, so the shade and the glare keep their
own colors.

Each pair must meet its bar under the Machado simulation of the deficiency and
in normal vision. A pair the theme keeps below a bar in normal vision only has
to keep 95% of what it has. So the filter never overrides a look the theme
chose, such as a relaxed cell contrast. Colors a theme repeats, as a ring
repeats a fill, stay equal.

### The solver

`filterBoard` is a position-based relaxation in OKLab, after Kuhn, Oliveira, and
Fernandes's mass-spring recoloring for dichromats:

1. Every color starts where the theme put it, so a board whose pairs all pass
   comes back unchanged.
2. Each round measures every pair on the 8-bit colors, as the theme tests do.
   For each failing pair, it moves the pair's two colors by the smallest step,
   in normal-vision OKLab, that brings the pair 20% past its bar, or 3% for a
   contrast. The step follows the slope of the simulated distance or log
   contrast, so colors move only in directions the deficiency can see.
3. Cells move a quarter as far as numbers and marks, and one step moves at most
   6 units. A color pushed out of the sRGB gamut keeps its lightness and hue and
   loses chroma.
4. It stops when every pair passes, or after 400 rounds with the best round
   kept. Hover, pressed, and edge shades then move with their cell.

The solver is plain arithmetic in a fixed order, so the same theme always gives
the same colors. `filterTheme` keeps each result in a `WeakMap` per resolved
theme and filter, and `themeFor` already keeps one resolved theme per entry,
accent, and mode.

### Filtered glyphs

SVG glyphs keep their own colors, which no variable names, so the solver can't
place them. Instead, `GlyphTextures` corrects their pixels when it draws a
texture, with `daltonizePixels` from `lib/themes/color.ts`.

The correction is an error-shifting daltonization, applied as one matrix on
linear light. What the simulation loses lies along one direction. Its amount
moves onto the chroma axis the deficiency sees best, at constant luminance. Both
axes come from the Machado matrix. Red-green filters turn reds bluer and greens
yellower, tritanopia turns blues redder, and grays stay put.

A filtered glyph gets a texture of its own, so the correction costs nothing per
frame. A Pixi `ColorMatrixFilter` would apply the matrix to gamma-encoded values
and draw each sprite through an extra render pass.

### Limits

1. Glyph colors get a push in the right direction, not a bar. Saturated colors
   clip at the edge of the gamut, so pure red moves less than a softer red.
2. A canvas the browser won't read back draws its glyph uncorrected, with a
   warning.
3. Window chrome keeps the theme's CSS tokens, and Settings shows a theme's
   `preview.png` as it is.
4. The plate, sheen, focus ring, win glow, flag pole, and the light on cells
   keep their colors. No pair depends on them alone.
5. The bars hold at full severity. Milder forms of each deficiency see colors
   between normal vision and the simulation. Both ends pass, and nothing
   measures the middle.

## The format version

`FORMAT_VERSION` in `format.ts` is 1, and every `theme.css` names its format in
the header. A theme with a newer format is skipped with "the theme needs format
N", so an older Polymine never draws a theme it would get wrong.

1. Adding an optional variable, a chrome token, or a glyph doesn't need a new
   format. An older build ignores a variable it doesn't know, and a keyword it
   doesn't know falls back to the default with a warning.
2. Raise the format when an existing variable changes meaning, or when a theme
   written for the new rules would look broken under the old ones. Keep reading
   the old format, converting as needed.

## Tests

| File                                | What it checks                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/themes/themes.test.ts`         | Every built-in theme, light and dark, untinted and with 20 macOS and Windows accents, against the checks below |
| `lib/themes/counts.test.ts`         | Count looks, rings, and the key's ranges                                                                       |
| `lib/themes/filter.test.ts`         | Every built-in theme and 180 random palettes under each color filter, against the pairs' bars                  |
| `lib/themes/color.test.ts`          | The per-pixel correction for glyphs                                                                            |
| `lib/themes/gloss.test.ts`          | The light's profiles, the looks and backdrops marks sit on, and the Settings preview's gradients               |
| `lib/board/light.test.ts`           | The light texture's rows, the matrix that lays a row across a shape, and each glare outline                    |
| `lib/themes/format.test.ts`         | The header, the single rule, every refusal, and the limits                                                     |
| `lib/themes/css.test.ts`            | `var()` substitution and the static color reader                                                               |
| `lib/themes/accent.test.ts`         | Text on the accent, and which chrome tokens the system accent fills in                                         |
| `lib/themes/resolve.test.ts`        | Defaults, number lists, fallbacks, chrome tokens, and the hidden element                                       |
| `lib/themes/library.test.ts`        | Player themes: skips, reuse, and glyph loading; each built-in loaded as a player's theme resolves as bundled   |
| `lib/board/glyphs.test.ts`          | Textures per size, density, and color filter                                                                   |
| `lib/board/BoardView.test.ts`       | SVG glyphs in place of drawn marks and digits, ring fills, the count readout, the light, and the glint         |
| `crates/polymine-ipc/src/themes.rs` | Allowed names, limits, links, refusals, listing order, and the built-in folders under the player rules         |
| `src-tauri/src/themes.rs`           | The command shapes, base64, and logging each skip once                                                         |

The theme tests hold every built-in theme except the experiments to these
checks:

1. Each number reaches 4.5:1 on an open cell.
2. Closed and open cells reach 3:1 at both ends of their shade.
3. The flag reaches 3:1 on every color a closed cell's shade and glare can put
   under it.
4. A tiling thumbnail's edges reach 3:1 on its closed cells.
5. A translucent theme's numbers reach 4.5:1 over white and black desktops.
6. A `digits` theme sets 12 distinct number colors, and they stay 2.5 OKLab
   units apart under each color vision deficiency.
7. A `colors` theme gives each count up to 14 its own look. Only counts drawn
   alike, both fills or both rings, need colors 10 apart, in normal vision and
   under each deficiency.

The accents are macOS's eight as `controlAccentColor` gives them in each mode,
and 12 Windows colors from blue to dark gray. A built-in theme relaxes a check
with a `Relaxed:` header line:

1. `cell-contrast` lowers closed against open cells to 1.4:1.
2. `pane-contrast` lowers it to 1.06:1, as far apart as an editor's panes, and
   checks that the question mark reaches 3:1 on a closed cell.
3. `number-separation` skips the color-blind separation check.
4. `number-readability` skips the check over white and black desktops.

Player themes aren't tested, and their `Relaxed` line is ignored.

The filter tests run every built-in theme except the experiments, light and
dark, untinted and with five strong accents, through each filter. Every pair
must meet its bar in normal vision and under the simulation. A board that
already passes must come back unchanged, and no color may move more than 15
units. The random palettes are seeded, so a failure reproduces. They come in
three kinds: digit and color themes that pass every bar in normal vision, the
same built so their colors collide under the deficiency, and colors picked with
no rule at all. `relations` in the test states each pair on its own, apart from
the solver.

## Extending themes

### Adding a built-in theme

Follow [Adding a theme](../../CONTRIBUTING.md#adding-a-theme) in
`CONTRIBUTING.md`. An experiment goes into `EXPERIMENTAL_THEMES` instead of
`BUILT_IN_ORDER`. A test in `crates/polymine-ipc/src/themes.rs` holds every
built-in folder to the player rules, so `cargo test` fails on a folder a player
couldn't load.

### Adding an editor theme

An editor theme borrows a code editor's look, as Atom One Dark and GitHub Light
do. It relaxes `pane-contrast` and draws its board the way the editor draws its
panes:

1. Open cells and the board plate take the editor background. Closed cells take
   a neighboring pane color, a sidebar or a panel: darker than the editor in a
   dark theme, and a shade below the page in a light one.
2. The closed edge sits a hair off the closed fill, as a pane border does. Cells
   are flat: no shade, bevel, sheen, or rim light.
3. Counts follow the editor's syntax colors in this order, skipping a token
   whose color an earlier count already took: keyword, field or property, type,
   function, string, operator, number, and comment. Count 1 gets the keyword
   color, which marks the editor at a glance. A comment gray too faint for 4.5:1
   gives way to the text color, and the editor's other accents fill the counts
   after that.
4. Take the colors from the editor's published theme, not from memory. Move one
   in OKLab lightness only when a test needs it, with a comment that names the
   old color, the new one, and the reason.
5. Credit the scheme in the header. `Author` names the scheme's author, as in
   `Author: Zeno Rocha, adapted by Polymine`, and a `Source:` line gives the
   palette's source URL. `parseHeader` in `format.ts` ignores `Source:`, as it
   ignores every line it doesn't know.
6. Add the theme to `EDITOR_COLUMNS` in `builtin.ts`, in one pair with its dark
   or light sibling. A row holds six themes, so a seventh column needs a wider
   grid or a third row. The grid tests fail until every column has a dark theme
   over a light one.

### Adding a number style

1. Add the keyword to `NumberStyle` in `lib/themes/types.ts` and to
   `KEYWORDS.numberStyle` in `lib/themes/resolve.ts`. Older builds fall back to
   `digits` with a warning, so the format stays 1.
2. Draw it in `BoardView.drawGlyph`. `countFill` shows how a style shares one
   `GraphicsContext` per shape and color.
3. Show it in the Settings preview in `SettingsDialog.svelte` and, if it needs
   one, in the key in `BoardCanvas.svelte`.
4. Teach `themes.test.ts` what a theme of that style must pass, as `colors`
   themes have their own separation bar and color count.
5. Describe the keyword in the player's guide.

### Changing the color filter

1. A new pair goes into the `Solver` constructor in `lib/themes/filter.ts`,
   through `relate`, and into `relations` in `filter.test.ts`.
2. A color the board draws with no pair keeps the theme's value. A shade that
   should follow its cell goes into `SHADES`.
3. A new deficiency needs a Machado matrix in `SIMULATION` in `color.ts`, a
   variant of `ColorFilter` in `src-tauri/src/settings.rs`, an entry in
   `COLOR_FILTERS` in `SettingsDialog.svelte`, and its label in `en.json`. The
   glyph correction derives itself from the matrix.
4. Run `npm test`, then look at a mid-game board through the simulation, with
   the filter off and on.

### Adding a variable or a chrome token

1. A board variable gets an entry in `VARIABLES` with its kind and default, a
   `BoardTheme` field, a line in `resolveTheme`, and a use in the renderer. A
   new kind needs a case in `parseValue`.
2. A chrome token goes into `app.css` with its default, into `CHROME_TOKENS`,
   and into the components that use it.
3. List it in the player's guide; a test fails until every variable is there.

## Downloaded themes

`crates/polymine-net` downloads a folder into a hidden staging folder beside its
target. To install a theme:

1. Call `download` with a `target` inside a hidden folder in
   `themes_dir(data_dir)`, such as `.install/<id>`. Pass `allowed_files()` as
   `allowed`, `MAX_THEME_BYTES` as `max_total_bytes`, and `max_depth: 0`. The
   download fills its own staging folder and renames it to `target` once it
   completes, and the listing ignores hidden folders meanwhile.
2. Check `target` with `polymine_ipc::themes::read_folder`, since `allowed`
   matches names without regard to case and the folder rules don't. Then rename
   it to a valid id that no built-in or renamed built-in theme uses.
3. The UI picks it up the next time the window comes to the front, or call
   `ThemeLibrary.load` after a command finishes. The CSS is checked there, and a
   theme that fails is listed at the bottom of Themes in Settings.
