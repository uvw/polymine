# App icon

## Summary

`ui/public/icon.svg` is the app icon: a steel mine on a dark plate with a faint
triangle lattice, with `ui/public/icon-small.svg` for 16 and 24 pixels.
`node scripts/app-icon.mjs` regenerates the platform icons in `src-tauri/icons`
from both. While Polymine runs, the window shows the same mine in the active
theme's colors, drawn by `ui/src/lib/themes/icon.ts`.
[Design](../design.md#window-icon) explains how, and
[Creating a theme](../themes/creating-a-theme.md#app-icon) lists the variables a
theme can set.

## Concept sheets

The `concepts` folder holds the sheets the icon was picked from. Open them in a
browser.

| Sheet                | What it shows                                                    |
| -------------------- | ---------------------------------------------------------------- |
| `icon-concepts.html` | Four early directions for the icon                               |
| `icon-styles.html`   | Seven styles of the mine, from pastel to realistic               |
| `icon-dark.html`     | The realistic mine on six dark plates; Poly grid is the app icon |
| `theme-icons.html`   | The window icon `icon.ts` draws for every built-in theme         |

`make_dark.py` builds `icon-dark.html` and its `dark-*.svg` files. Run it with
`python docs/icons/concepts/make_dark.py`. `theme-icons.html` is a snapshot of
the `icon.ts` output on 2026-11-07, in light and dark mode.
