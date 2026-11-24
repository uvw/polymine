# Creating a theme

## Summary

A Polymine theme is a folder with one required file, `theme.css`. That file sets
the colors, the shapes, and a few switches with CSS variables. You don't need to
know the code, and a theme can't break Polymine: a theme that breaks the rules
is skipped, and Settings says why.

1. Open Settings, choose Themes, and select **Open themes folder**.
2. Make a folder for your theme in it, such as `dusk`.
3. Save a `theme.css` in that folder. [A minimal theme](#a-minimal-theme) has
   one to copy.
4. Switch back to Polymine. Your theme appears in the Custom section of Themes
   in Settings, in folder-name order.

Optional files replace the drawn mine, flag, question mark, and numbers with
your own SVG images, and a `preview.png` shows in the theme list.

This guide starts with a working theme, then covers the looks you can add, how
to keep the board readable, and every variable.

## Contents

- [Where themes live](#where-themes-live)
- [A minimal theme](#a-minimal-theme)
- [Start from a built-in theme](#start-from-a-built-in-theme)
- [Light and dark mode](#light-and-dark-mode)
- [Light boards](#light-boards)
- [The system accent color](#the-system-accent-color)
- [See-through themes and alpha](#see-through-themes-and-alpha)
- [The frosted material](#the-frosted-material)
- [Glyphs and the preview](#glyphs-and-the-preview)
  - [SVG glyphs](#svg-glyphs)
  - [The preview](#the-preview)
- [Keep the board readable](#keep-the-board-readable)
- [Color filters](#color-filters)
- [Every variable](#every-variable)
  - [Theme settings](#theme-settings)
  - [Board](#board)
  - [Cells](#cells)
  - [Light on cells](#light-on-cells)
  - [Marks and effects](#marks-and-effects)
  - [App icon](#app-icon)
  - [Numbers](#numbers)
  - [Window chrome](#window-chrome)
- [Limits](#limits)
- [What gets refused](#what-gets-refused)
- [Troubleshooting](#troubleshooting)

## Where themes live

Settings opens the themes folder for you, and creates it the first time:

| System  | Themes folder                                   |
| ------- | ----------------------------------------------- |
| macOS   | `~/Library/Application Support/Polymine/themes` |
| Windows | `%APPDATA%\Polymine\themes`                     |
| Linux   | `~/.local/share/Polymine/themes`                |

A portable copy of Polymine keeps its themes in `data\themes` beside the app.

Each theme is a folder directly inside `themes`. The folder's name is the
theme's id: 1 to 40 lowercase letters, digits, or hyphens, starting with a
letter or a digit, such as `dusk` or `neon-2`.

Polymine reads the folder when it starts, when you open Settings, and each time
its window comes to the front. To try a change, save the file and click back
into Polymine.

## A minimal theme

This is a complete theme. Every variable you leave out keeps its default, so a
theme can be this short. Save it as `themes/dusk/theme.css`:

```css
/*
 * Name: Dusk
 * Author: Your Name
 * Description: Warm tiles on a dark plum tray
 * Version: 1.0.0
 * Format: 1
 */
:root {
  --board-plate: #1b1020;
  --cell-closed: #7a4e6e;
  --cell-closed-hover: #8c5c7f;
  --cell-closed-pressed: #5f3c56;
  --cell-closed-edge: #93688a;
  --cell-open: #251829;
  --cell-open-edge: #3a2840;
}
```

The comment at the top is the header. Polymine needs all five lines:

1. **Name:** shown in Settings, up to 40 characters.
2. **Author:** shown after the description, up to 80 characters.
3. **Description:** shown in Settings, up to 120 characters.
4. **Version:** your theme's own version, up to 20 characters.
5. **Format:** the theme format, which is `1`. If a future Polymine changes the
   format, this number tells an old theme from a new one.

The lines can come in any order, and Polymine ignores header lines it doesn't
know. Most built-in themes carry a `Relaxed:` line that loosens a test check for
a look kept on purpose; in your theme it does nothing.

After the header comes one `:root { … }` block. It holds only variables: names
that start with `--`, each followed by a colon, a value, and a semicolon. The
header must be the file's first comment. After it you can add comments anywhere,
and you can define helper variables of your own and use them with `var()`.

## Start from a built-in theme

The quickest way to a good theme is to change one that already works. This is
Graphite, the built-in theme that most others started from:

```css
/*
 * Name: Graphite
 * Author: Polymine
 * Description: Matches light or dark mode
 * Version: 1.0.0
 * Format: 1
 */
:root {
  --color-scheme: light dark;
  --window-material: default;
  --number-style: digits;

  /* A recessed graphite tray that reads well on light and dark chrome. */
  --board-plate: color-mix(in srgb, #14161b, var(--system-accent, #14161b) 12%);
  --board-gap: 2px;
  --board-font:
    "Segoe UI Variable Display", "Segoe UI", -apple-system, ui-rounded, system-ui, sans-serif;
  --board-font-weight: 700;

  --cell-rounding: 0.22;
  --cell-bevel: 0.05;
  --cell-sheen: rgb(255 255 255 / 7%);
  --cell-closed: #667089;
  --cell-closed-hover: color-mix(in srgb, #737e99, var(--system-accent, #737e99) 35%);
  --cell-closed-pressed: #4e5669;
  --cell-closed-edge: color-mix(in srgb, #6f7991, var(--system-accent, #6f7991) 30%);
  --cell-open: #1e2128;
  --cell-open-edge: #363c48;
  --cell-exploded: #d64545;

  --flag: #ff7043;
  --flag-outline: #14161b;
  --flag-pole: #e6e8ee;
  --question: #f0e442;
  --mine: #0e0f12;
  --mine-spark: #f07848;
  --mine-spikes: 4;
  --hint: #56b4e9;
  --focus: #ffffff;
  --win: #2fc79c;

  /* Checked for color-blind separation. */
  --number-1: #56b4e9;
  --number-2: #2fc79c;
  --number-3: #f07848;
  --number-4: #d88cc0;
  --number-5: #e9a23b;
  --number-6: #f0e442;
  --number-7: #b9c3ff;
  --number-8: #dfe3ea;
  --number-9: #ff8fa3;
  --number-10: #8fe3d2;
  --number-11: #c7a7ff;
  --number-12: #ffc9a8;
}
```

1. Open the themes folder from Settings and make a folder named `my-graphite`.
2. Copy the block above into a new file named `theme.css` in that folder.
3. Change the header: give it your own **Name**, **Author**, and
   **Description**.
4. Change a few colors. For a green board, try `--cell-closed: #4f7a5c;`,
   `--cell-closed-pressed: #3d5f47;`, and `--board-plate: #0f1a13;`.
5. Save the file, switch back to Polymine, and open Settings. Pick your theme in
   Themes.
6. Keep editing. Each time you click back into Polymine, it reads the file
   again.

Graphite follows the system's mode and uses the system's window colors. For a
theme with a fixed mode and window colors of its own, start from Atom One Dark,
which is dark, or Atom One Light, which is light. Their files are in Polymine's
source, in [`ui/src/themes`](../../ui/src/themes).

## Light and dark mode

With `--color-scheme: light dark`, the window follows the system, and so can
your board. `light-dark(a, b)` gives `a` in light mode and `b` in dark mode,
inside any color:

```css
:root {
  --cell-open: light-dark(#e8eaf0, #1e2128);
}
```

`--color-scheme: dark` or `light` fixes the mode for the board and the window
chrome alike, whatever the system says.

## Light boards

The defaults suit a dark board. A board with light open cells also needs these
changes:

1. Closed cells dark enough to reach 3:1 against the open ones. Next to
   near-white open cells, that means a middle tone, such as `#8b8f9c` or darker.
   A little hue keeps a field of them from looking gray.
2. Number colors dark enough to reach 4.5:1 on the open cells. A pastel that
   reads on a dark cell fades on a light one.
3. A dark `--focus`. The default white ring disappears on a light board.
4. A `--flag-pole`, `--flag-outline`, and `--question` that show on your closed
   cells, since the default pole and question mark are light.
5. More alpha in a white `--cell-sheen`, such as 20%, so the highlight shows on
   a light tile.

## The system accent color

Polymine sets `--system-accent` to the accent color you chose in macOS or
Windows. It's set only when the system has one and "Tint the theme with the
system accent color" is on in Settings, so always give a fallback:

```css
:root {
  /* The accent itself, or blue when there is none. */
  --hint: var(--system-accent, #3b82f6);
  /* Your color, moved 35% toward the accent: a tint. */
  --cell-closed-hover: color-mix(in srgb, #737e99, var(--system-accent, #737e99) 35%);
}
```

The built-in themes show a few ways to use it:

1. Most built-in themes that follow the system's mode tint the plate, the
   hovered cell, and the closed cell edge this way. Midnight has no plate and
   tints the other two.
2. Swatch and Glossy build their closed cells from the accent itself, as in
   Swatch's `--swatch: var(--system-accent, #007aff);` and
   `--cell-closed: var(--swatch);`.
3. Glass also tints its rim light and its dark-mode closed cells.
4. The themes after code editors tint only the hovered cell, so they keep their
   own colors.

A theme that sets no `--accent` of its own also gets the system accent on its
buttons and selections. The Themes page draws each theme's preview with the
accent, as the board would.

## See-through themes and alpha

Board colors are solid. If a board color has alpha, Polymine drops it and the
log says so. Three opacity variables make whole layers see-through instead:
`--board-plate-opacity`, `--cell-closed-opacity`, and `--cell-open-opacity`.
They take a number from `0` to `1` or a percentage. A hovered closed cell is a
little more solid than the rest, and a closed cell's edge a little less.

Keeping the opacity apart from the color lets you mix a color with the accent
without changing how see-through it is. `--cell-sheen` is the one board color
that takes alpha, since the sheen is a highlight laid over the cell.

The glare and the rim light from [light on cells](#light-on-cells) draw at their
own opacities over a see-through cell, so they stay bright on clear glass. The
shade mixes into the cell's color, so it fades with the cell: at 10%, a shade
barely shows. Glass sets no shade for that reason.

Window chrome tokens can use alpha freely, as in `rgba(138, 152, 255, 0.16)`.

## The frosted material

`--window-material` picks what shows behind the window:

1. `default`: the system's usual material, Mica on Windows 11 and the sidebar
   material on macOS.
2. `frosted`: a light blur of the desktop, Acrylic on Windows 11 and the
   under-window material on macOS. Pair it with low opacities so the blur shows
   through. Frost uses 15% for the plate, 14% for closed cells, and 6% for open
   ones. Glass adds a glare and a rim light to cells that clear.
3. `none`: an opaque window painted with `--window` and `--window-image`, as in
   Midnight.

Windows 10 and Linux have no material, so the window is opaque there whatever
the theme says.

## Glyphs and the preview

### SVG glyphs

SVG files in the theme's folder replace the drawn marks and numbers:

| File                | Replaces                                      |
| ------------------- | --------------------------------------------- |
| `mine.svg`          | The mine, shown after a loss                  |
| `flag.svg`          | The flag, and the faded flag on a wrong guess |
| `question.svg`      | The question mark                             |
| `1.svg` to `14.svg` | That count's digit                            |

1. Each SVG is drawn centered in its cell, scaled to fit a square 1.3 times the
   cell's inradius wide. That's about two thirds of the widest circle that fits
   in the cell. The SVG keeps its shape, so a square `viewBox`, such as
   `viewBox="0 0 100 100"`, fills the square. Draw out to the edges of the
   `viewBox`, since any margin inside it shrinks the glyph further.
2. Polymine draws the SVG as it is, unless the player turns on a
   [color filter](#color-filters). The theme's colors don't change it, so put
   the colors you want in the file.
3. With `--number-style: colors`, a number's SVG sits on top of the color fill,
   so you can mark counts with shapes as well as colors. It also takes the place
   of the digit the cell under the pointer shows.
4. Polymine shows each SVG as a picture. Scripts in it never run, and it can't
   load anything from the internet or your disk. Keep everything in the one
   file: every `href` and every `url()` must point at an `id` in it, such as
   `href="#pole"` or `fill="url(#glow)"`. Everything inside it works, including
   `<defs>`, gradients, filters such as a glow, `<use>`, and a `<style>`
   element. To use a picture, draw it in SVG; a bitmap in a `data:` URL is
   refused.
5. The flag and question mark sit on closed cells and the mine on open ones, so
   give each glyph an outline or colors that show on that cell.

### The preview

Each card on the Themes page draws a small hex board in your theme's colors,
with your SVG glyphs, font, glare, and shade, so most themes need no preview
image. `preview.png` replaces that drawn board. It shows at about 160 by 92
pixels and is cropped to fill, so an image of 320 by 184 pixels stays sharp on
high-density screens. A picture doesn't follow the accent, the light or dark
mode, or the color filter, so leave it out when your theme depends on them.

## Keep the board readable

Polymine tests every built-in theme against these targets. It doesn't test
yours, so check them with any WCAG contrast checker:

1. Each number color reaches 4.5:1 against `--cell-open`.
2. `--cell-closed` and `--cell-open` reach 3:1 against each other, so a player
   can tell what's still closed at a glance.
3. `--flag` or `--flag-outline` reaches 3:1 against `--cell-closed`.
4. No two number colors look alike to a player with a color vision deficiency.
   With `--number-style: colors`, they also stay apart in normal vision. Give
   red and green counts different lightness, since many players can't tell those
   hues apart.

Check each mark against the cell it sits on. Numbers and the mine sit on open
cells, and the mine you opened sits on `--cell-exploded`. The flag and the
question mark sit on closed cells, so `--question` needs contrast against
`--cell-closed`, not `--cell-open`.

With [light on your cells](#light-on-cells), the color under each mark changes
from one spot to the next. The tests check each target against every color the
shade and the glare can put there:

1. A closed cell at both ends of its shade.
2. The same, under the glare at its brightest and at its faintest.
3. An open cell at both ends of its shade.

Check yours the same way: mix the shade or the glare into the cell's color at
its opacity, and check the mark against the result. The flat sheen stays out of
these checks. A light question mark on a dark tile fades under a white glare, so
give it a dark `--question-outline`, as Glossy does.

## Color filters

Players can turn on a color filter in Settings, under Themes: deuteranopia or
protanopia for the two kinds of red-green color blindness, or tritanopia for
blue-yellow. It works on your theme too, with nothing to set up. The filter
checks the colors a player has to tell apart as they look with that color
blindness, and moves only those that fall short:

1. Number colors that look alike move apart, by 2.5 OKLab units with digits and
   by 10 with `--number-style: colors`.
2. Digits keep 4.5:1 on open cells. Reds look darker with protanopia, so a red
   digit on a dark board often gets a little lighter.
3. Closed and open cells, the flag, the question mark, and the mine on its blast
   keep their contrast.
4. The hint ring stays apart from the flag ring, and the opened mine's cell from
   an open cell.

The filter holds your theme to the targets in
[Keep the board readable](#keep-the-board-readable), for normal vision and for
the filter's color blindness alike. A few things stay as you made them:

1. A target your theme misses on purpose, such as low contrast between cells,
   stays as low as you made it.
2. Colors you repeat, such as `--number-9: var(--number-1)`, stay equal.
3. The hover, pressed, and edge shades move with their cell.
4. With light on your cells, the filter checks each mark against every color the
   shade and the glare can put under it, as the tests do. The light's own colors
   stay as you set them.

If your theme already meets the targets for a kind of color blindness, the
filter changes nothing. Otherwise the change is small: the built-in themes move
by under ten OKLab units, at most about four just-noticeable steps, and colors
keep their hue family where they can.

The filter can't read meaning into your SVG glyphs, so it shifts their colors by
a fixed rule instead. Reds turn bluer and greens yellower for the red-green
filters, and blues turn redder for tritanopia. Black, white, and grays stay put.
The window's colors and your `preview.png` don't change. To see what each filter
does, choose your theme and switch the filter in Settings; the theme previews
follow it too.

## Every variable

Each variable is optional. A variable you leave out takes the default in these
tables. Colors are any CSS color: `#rrggbb`, `rgb()`, `hsl()`, `oklch()`, a
named color, `color-mix()`, `light-dark()`, or `var()` of another variable.

### Theme settings

| Variable             | What it does                                                                         | Default      |
| -------------------- | ------------------------------------------------------------------------------------ | ------------ |
| `--color-scheme`     | `light dark` follows the system's mode; `light` or `dark` fixes one, chrome included | `light dark` |
| `--window-material`  | `default` for the system's window material, `frosted` for a blur, `none` for opaque  | `default`    |
| `--number-style`     | `digits` draws counts as numbers; `colors` fills the cell with the count's color     | `digits`     |
| `--number-ring-from` | With `colors`, counts from this one up draw as a ring instead of a fill, or `none`   | `none`       |

### Board

| Variable                | What it does                                                                      | Default             |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------- |
| `--board-plate`         | The tray behind the cells, or `none` for no tray                                  | `#14161b`           |
| `--board-plate-opacity` | How solid the tray is, from `0` to `1` or `0%` to `100%`                          | `1`                 |
| `--board-gap`           | Space between cells, in pixels, from `0` to `16px`                                | `2px`               |
| `--board-font`          | The font for numbers and the question mark, as a font list                        | System fonts, below |
| `--board-font-weight`   | `100` to `900` in steps of 100, `normal`, or `bold`                               | `700`               |
| `--board-effects`       | Effects Polymine draws over the board, by name and separated by spaces, or `none` | `none`              |

The default font list is:

```css
"Segoe UI Variable Display", "Segoe UI", -apple-system, ui-rounded, system-ui, sans-serif
```

A theme can't load font files, so it can name only fonts installed on the
player's system.

Board effects are shaders that ship with Polymine. A theme picks them by name
and can't bring its own. The only one so far is `ferrofluid`, an experiment:
closed cells become a pool of glossy black fluid that throws up spikes toward
the pointer, and a flag becomes a tall spike. It takes these variables:

1. `--cell-closed` for the fluid's color.
2. `--cell-gloss` for its highlights.
3. `--cell-rim` for the light at its edges.
4. `--flag` for the glow on a flag's tip.
5. `--cell-light-angle` for where the light comes from.

An unknown name, or one named twice, leaves the board without effects.

### Cells

| Variable                | What it does                                                                         | Default                 |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| `--cell-closed`         | A closed cell                                                                        | `#667089`               |
| `--cell-closed-hover`   | A closed cell under the pointer                                                      | `#737e99`               |
| `--cell-closed-pressed` | A closed cell while pressed                                                          | `#4e5669`               |
| `--cell-closed-edge`    | The thin edge of a closed cell                                                       | `#6f7991`               |
| `--cell-closed-opacity` | How solid closed cells are, from `0` to `1` or `0%` to `100%`                        | `1`                     |
| `--cell-sheen`          | The raised highlight on closed cells; this color takes alpha                         | `rgb(255 255 255 / 7%)` |
| `--cell-bevel`          | The width of the rim around the sheen, as a share of the cell's inradius, `0` to `1` | `0.05`                  |
| `--cell-rounding`       | Corner rounding, as a share of the cell's inradius, `0` to `1`, at most 6 pixels     | `0.22`                  |
| `--cell-open`           | An open cell                                                                         | `#1e2128`               |
| `--cell-open-edge`      | The thin edge of an open cell                                                        | `#363c48`               |
| `--cell-open-opacity`   | How solid open cells are, from `0` to `1` or `0%` to `100%`                          | `1`                     |
| `--cell-exploded`       | The cell of the mine you opened, the cross on a wrong flag, and the blast            | `#d64545`               |

How the cell variables draw a cell:

1. Each cell's edge is a one-pixel line along its outline, half inside the cell
   and half in the gap. The tray shows only where the gap is wider than that
   line. With `--board-gap: 1px` the cells touch, and the edge colors draw the
   lines between them. A flat grid with visible lines needs a gap of `2px` or
   more, or edge colors darker than the cells.
2. The sheen covers a closed cell inset by `--cell-bevel`, so the bevel shows as
   a rim of the closed color around it. With a bevel of `0`, the sheen covers
   all but a one-pixel rim. A sheen with no alpha, such as
   `rgb(255 255 255 / 0%)`, makes flat cells. A pressed cell has no sheen.
3. Rounding stops at 6 pixels, so small cells look rounder than large ones.
   Triangles round their corners only as far as half the gap, since six corners
   meet at each point.

### Light on cells

These variables light the cells from one direction, so closed cells read as
raised, glazed tiles and open cells as recessed. Every one starts off, so a
theme that sets none of them draws flat cells. Glossy uses them all.

| Variable                    | What it does                                                                   | Default   |
| --------------------------- | ------------------------------------------------------------------------------ | --------- |
| `--cell-light-angle`        | Where the light comes from, clockwise from the top, such as `-15deg`           | `0deg`    |
| `--cell-gloss`              | The glare on closed cells                                                      | `#ffffff` |
| `--cell-gloss-opacity`      | The glare's opacity at its lit end; `0` for no glare                           | `0`       |
| `--cell-gloss-fade`         | The glare's opacity at its far end                                             | `0`       |
| `--cell-gloss-extent`       | How far the glare reaches from the lit edge, as a share of the cell, `0`–`1`   | `0.5`     |
| `--cell-gloss-shape`        | `band` cuts the glare straight, `arc` bows it like a dome, `spot` makes a disc | `arc`     |
| `--cell-glint-opacity`      | A band of the glare's color that sweeps a closed cell under the pointer        | `0`       |
| `--cell-rim`                | A light line inside the edges of closed cells                                  | `#ffffff` |
| `--cell-rim-opacity`        | The rim light's opacity on the edges it faces; `0` for none                    | `0`       |
| `--cell-rim-width`          | The rim light's width, in pixels, from `0` to `16px`                           | `1px`     |
| `--cell-rim-angle`          | Which edges the rim light faces, clockwise from the top                        | `180deg`  |
| `--cell-shade`              | The shade on closed cells, darkest at the edge away from the light             | `#000000` |
| `--cell-shade-opacity`      | The closed cells' shade at its darkest; `0` for none                           | `0`       |
| `--cell-shade-depth`        | How far both shades reach into a cell, as a share of the cell, `0`–`1`         | `0.5`     |
| `--cell-open-shade`         | The shade on open cells, darkest under the lit edge                            | `#000000` |
| `--cell-open-shade-opacity` | The open cells' shade at its darkest; `0` for none                             | `0`       |

Angles take `deg`, `turn`, `rad`, or `grad`, or `0` alone. A bare number such as
`15` is refused and takes the default. How the light draws a cell:

1. Each layer runs across the cell along the light, from the edge facing it to
   the far edge, so it fits every cell shape. A triangle's glare sits in its tip
   when the tip points at the light.
2. The shade mixes into the cell's own color, darkest at its edge and gone at
   the depth you set. A pressed cell takes the open cells' shade, so it looks
   pushed in, and so does the cell of the mine you opened.
3. The glare covers the cell inset by `--cell-bevel`, out to its extent, and
   fades from `--cell-gloss-opacity` to `--cell-gloss-fade`. It draws over the
   sheen, so most lit themes set the sheen to no alpha.
4. The rim light fades out over 60% of the cell from the edges it faces, and its
   width stops at 30% of the cell's inradius. `180deg` lights the bottom edges,
   like light coming through candy.
5. The glint runs once each time the pointer moves onto a closed cell, and never
   with Reduce Motion on.
6. `light-dark()` works in the colors, not in the opacities. To make a shade
   gentler in one mode, give it a lighter color there.

### Marks and effects

| Variable             | What it does                                             | Default   |
| -------------------- | -------------------------------------------------------- | --------- |
| `--flag`             | The flag's cloth                                         | `#ff7043` |
| `--flag-outline`     | The thin outline that keeps the flag visible on its cell | `#14161b` |
| `--flag-pole`        | The flag's pole and base                                 | `#e6e8ee` |
| `--question`         | The question mark                                        | `#f0e442` |
| `--question-outline` | An outline around the question mark, or `none`           | `none`    |
| `--mine`             | The mine's body                                          | `#0e0f12` |
| `--mine-spark`       | The mine's spikes and rim                                | `#f07848` |
| `--mine-spikes`      | How many spikes the mine has, `0` to `12`                | `4`       |
| `--hint`             | The ring around a cell the hint says to open             | `#56b4e9` |
| `--focus`            | The keyboard focus ring                                  | `#ffffff` |
| `--win`              | The glow and confetti when you win                       | `#2fc79c` |

### App icon

While Polymine runs, the window's icon is a mine on a plate in the theme's
colors. On Windows that's the title bar, the taskbar, and Alt+Tab; macOS has no
window icon. By default the icon takes its colors from the board:

1. The plate takes the board plate, or the open cell when the plate is `none`.
   In light mode a dark plate turns light, and in dark mode a light one turns
   dark.
2. The spikes take the closed cell.
3. The ball takes `--mine`, and one lit tip takes `--mine-spark`.

Set these to choose its colors yourself:

| Variable       | What it does                                     | Default |
| -------------- | ------------------------------------------------ | ------- |
| `--icon-plate` | The plate behind the mine, or `none` for derived | `none`  |
| `--icon-metal` | The spikes, the halo, and the plate's edge       | `none`  |
| `--icon-mine`  | The mine's ball                                  | `none`  |
| `--icon-spark` | The lit tip of one spike                         | `none`  |

### Numbers

`--number-1` to `--number-14` color the counts. Crosses gives a cell up to 14
neighbors, and Triangles, Shards, Snub squares, Bands, and Rosettes up to 12.
Polymine ignores `--number-15` and up, and the log says so.

1. Set the colors from `--number-1` up. The list ends at the first number you
   leave out, so `--number-1` to `--number-8` makes a list of eight.
2. With `digits`, a count past the end of the list takes the colors again from
   the start: with eight colors, 9 looks like 1. The built-in digit themes set
   12, so only Crosses repeats a color.
3. With `colors`, give every count up to 14 a look of its own. Past the end of
   the list, the last color stands for every larger count.
4. `--number-ring-from` gives high counts a second cue that works on every cell
   shape. From that count up, the color fills a band inside the cell's edge and
   the middle stays open. Pride and Spectrum ring 9 to 14 in the colors of 1 to
   6, with `--number-9: var(--number-1);` and so on, so a ring in the first
   color means 9. A ring and a fill can share a color; counts drawn alike can't.
5. With `colors`, a key under the board shows every count the board can reach.
   The cell under the pointer or the keyboard focus shows its count as a digit,
   and its entry in the key lights up. A player can turn the key off in Settings
   for a harder game.
6. `--number-shadow` and `--number-shadow-opacity`, `#000000` and `0` by
   default, put a soft shadow under each digit, away from the light. A white one
   in a light theme reads as an engraved digit.
7. A theme that sets no number colors gets these 12: `#56b4e9`, `#2fc79c`,
   `#f07848`, `#d88cc0`, `#e9a23b`, `#f0e442`, `#b9c3ff`, `#dfe3ea`, `#ff8fa3`,
   `#8fe3d2`, `#c7a7ff`, and `#ffc9a8`.

### Window chrome

A theme may also restyle the window around the board: the toolbar, menus, and
dialogs. It can set only these tokens, and Polymine ignores any other. Leave
them all out to keep the system's look, as the built-in themes that follow the
system's mode do. Midnight and the themes after code editors set their own.

| Variable                                            | What it colors                                        |
| --------------------------------------------------- | ----------------------------------------------------- |
| `--text`, `--text-dim`                              | Text, and quieter text such as help lines             |
| `--accent`, `--accent-hover`, `--on-accent`         | Selected items and primary buttons, and text on them  |
| `--on-menu-highlight`                               | Text on the highlighted menu item                     |
| `--danger`, `--warning`                             | Error and warning text                                |
| `--window`                                          | The window's background when it's opaque              |
| `--window-image`                                    | Gradients painted over that background                |
| `--control`, `--control-hover`, `--control-pressed` | Buttons and fields                                    |
| `--subtle-hover`, `--subtle-pressed`                | Rows and icon buttons under the pointer               |
| `--stroke`, `--stroke-strong`, `--divider`          | Outlines and dividers                                 |
| `--surface`, `--layer`                              | Dialogs, menus, and panels                            |
| `--shadow`                                          | The shadow under dialogs and menus, as a `box-shadow` |
| `--accent-image`                                    | A gradient that replaces the primary button's accent  |

The gradient tokens take `linear-gradient()`, `radial-gradient()`,
`conic-gradient()`, and their `repeating-` forms, and `--window-image` also
takes `none`. When a theme sets no `--accent`, the system accent fills in
`--accent`, `--accent-hover`, and `--on-accent`, and any of them the theme sets
wins. A theme that sets `--accent` gets none of the system values, so set all
three together.

1. A token you leave out keeps the system's value for the theme's mode. Set the
   tokens that sit on each other together: a theme with its own `--surface` also
   needs `--text` and `--text-dim` that read on it.
2. `--on-accent` is the text on every accent fill, including primary buttons
   painted with `--accent-image`. That gradient also stays on hover, so check
   the text against both ends of it.
3. `--on-menu-highlight` is white in both modes unless the theme sets it.
4. The board's own font comes from `--board-font`. The window's text keeps the
   system font.

## Limits

These limits keep a theme small, fast to read, and harmless.

| What                                                | Limit                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `theme.css`                                         | 32 KiB, up to 300 variables, names up to 64 characters, values up to 1,000 characters |
| Each SVG                                            | 32 KiB                                                                                |
| `preview.png`                                       | 256 KiB, at most 1024 by 1024 pixels                                                  |
| `README.md`, `LICENSE`, `LICENSE.md`, `LICENSE.txt` | 64 KiB each; Polymine never reads them                                                |
| All files in one theme together                     | 1 MiB                                                                                 |
| Entries in one theme folder                         | 64, hidden files included                                                             |
| Themes                                              | 64; folders past that, in name order, are skipped                                     |

## What gets refused

A theme is skipped when any of these is true. Themes in Settings lists it at the
bottom, as "dusk didn't load:" and the reason.

1. **Files other than the ones above.** Names must match exactly, case included:
   `Theme.css` or `notes.txt` is refused. Hidden files, such as `.DS_Store`, and
   the files Windows leaves, `Thumbs.db` and `desktop.ini`, are ignored.
2. **Subfolders and links.** A theme holds only plain files, and Polymine never
   follows a link or reads a hard-linked file, so a theme can't point at other
   files on your disk.
3. **Anything that could load or run something.**
   1. In `theme.css`: `url()`, `@import`, backslash escapes, `!important`, the
      characters `@`, `{`, `}`, `<`, `>`, and `!` in a value, and any function
      besides colors, `color-mix()`, `light-dark()`, `var()`, `calc()`, `min()`,
      `max()`, `clamp()`, and gradients.
   2. In an SVG: scripts, `foreignObject`, DOCTYPE and entity declarations,
      `javascript:` links, and anything that points outside the file. That's an
      `href`, `xlink:href`, or `src` on any element that doesn't start with `#`,
      including a `data:` URL, and a `url()` anywhere in the file, comments
      included, that doesn't start with `#`. `@import`, `image-set()`,
      `xml:base`, an animation of `href`, and processing instructions other than
      `<?xml ...?>` are refused too. Namespace declarations such as
      `xmlns:xlink` are fine. Polymine reads the SVG files when you pick the
      theme, so a refused one shows in the log, as `could not read theme`, and
      the theme draws its own marks instead.
   3. Polymine looks for `url(`, `@import`, and backslashes in the whole of
      `theme.css`, comments and the header included. A header line such as
      `Description: see url(...)` gets the theme skipped.
4. **A broken `theme.css`.** A missing header line, a `Format` newer than
   Polymine reads, a selector other than `:root`, a property that isn't a
   variable, a declaration of `--system-accent`, unbalanced parentheses, an
   unclosed string or comment, more than 300 variables, or text that isn't
   UTF-8. An SVG with no `<svg` element or with broken markup, such as an
   attribute without quotes, and a `preview.png` that isn't a real PNG are
   refused too.
5. **A folder name a built-in theme uses or used,** such as `frost`, or
   `velvet`, an old id of Dracula. Rename the folder.

A value that's merely wrong, such as `--board-gap: 3em`, doesn't skip the theme.
That variable takes its default, and the log says so.

## Troubleshooting

When a theme doesn't show up, or looks wrong:

1. Open Settings, then Themes. The bottom of the page names each skipped folder
   and why.
2. Make sure the folder sits directly inside `themes`, not inside another
   folder, and that its name is lowercase.
3. Read the log for the details, such as a variable that took its default. Lines
   about themes start with `skipped theme` or `theme <id>:`.

| System  | Log file                                            |
| ------- | --------------------------------------------------- |
| macOS   | `~/Library/Logs/dev.uvw.polymine/Polymine.log`      |
| Windows | `%LOCALAPPDATA%\dev.uvw.polymine\logs\Polymine.log` |
| Linux   | `~/.local/share/dev.uvw.polymine/logs/Polymine.log` |

A portable copy writes its log to `data\logs`. If you use the command line,
`polymine-cli log` prints the end of the log, and `polymine-cli paths` shows
where the themes folder is.
