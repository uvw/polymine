/** The themes that ship with Polymine: the folders in `ui/src/themes`, read at build time. */
import { themeEntry, isGlyphName } from "./entry";
import type { GlyphName } from "./format";
import type { ThemeEntry } from "./types";

type Files = Record<string, string>;

const CSS: Files = import.meta.glob("../../themes/*/theme.css", {
  query: "?raw",
  import: "default",
  eager: true,
});
const SVG: Files = import.meta.glob("../../themes/*/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
const PREVIEW: Files = import.meta.glob("../../themes/*/preview.png", {
  query: "?url",
  import: "default",
  eager: true,
});

/** Columns in the Settings theme grid. `.theme-grid` in `SettingsDialog.svelte` must match. */
export const THEME_GRID_COLUMNS = 6;

/**
 * The Code tab's columns, each a dark theme over a light one. Most are one
 * scheme's pair. One Dark Pro has no light variant, so Catppuccin Latte, which
 * has no dark one here, fills its column.
 */
export const EDITOR_COLUMNS: readonly (readonly [dark: string, light: string])[] = [
  ["atom-one-dark", "atom-one-light"],
  ["dracula", "alucard"],
  ["github-dark", "github-light"],
  ["one-dark-pro", "catppuccin-latte"],
  ["monokai", "monokai-light"],
  ["solarized-dark", "solarized-light"],
];

/** The Code tab in grid order: the dark themes fill the first row and the light ones the second. */
export const EDITOR_ORDER: readonly string[] = [
  ...EDITOR_COLUMNS.map(([dark]) => dark),
  ...EDITOR_COLUMNS.map(([, light]) => light),
];

/** Settings shows the built-in themes in this order, `DEFAULT_THEME_ID` first. */
export const BUILT_IN_ORDER = [
  "frost",
  "glossy",
  "glass",
  "graphite",
  "charcoal",
  "swatch",
  "pride",
  "spectrum",
  "midnight",
  ...EDITOR_ORDER,
];

/**
 * Built-in themes that try out a board effect. Only development builds, and
 * builds made with `VITE_EXPERIMENTS=1`, list them, after the rest, until one
 * is ready to ship.
 */
export const EXPERIMENTAL_THEMES: readonly string[] = ["ferrofluid"];

/** Where Settings lists a theme: on Polymine's own tab, the code editors' tab, or the player's. */
export type ThemeGroup = "polymine" | "editor" | "player";

/** Built-in themes that take a code editor's color scheme. */
export const EDITOR_THEMES: ReadonlySet<string> = new Set(EDITOR_ORDER);

export function themeGroup(entry: Pick<ThemeEntry, "id" | "builtIn">): ThemeGroup {
  if (!entry.builtIn) return "player";
  return EDITOR_THEMES.has(entry.id) ? "editor" : "polymine";
}

/**
 * Ids the editor themes had before they took their sources' names. A saved
 * setting with one of them opens the theme it became, and a player's folder
 * can't take one.
 */
export const RENAMED_BUILT_INS: ReadonlyMap<string, string> = new Map([
  ["orbital-night", "atom-one-dark"],
  ["nightshift", "one-dark-pro"],
  ["velvet", "dracula"],
  ["night-market", "monokai"],
  ["late-commit", "github-dark"],
  ["orbital-day", "atom-one-light"],
  ["clean-diff", "github-light"],
  ["sundial", "solarized-light"],
  ["marshmallow", "catppuccin-latte"],
]);

const folderOf = (path: string) => path.split("/").at(-2) ?? "";
const fileOf = (path: string) => path.split("/").at(-1) ?? "";
const rank = (id: string) => {
  const at = [...BUILT_IN_ORDER, ...EXPERIMENTAL_THEMES].indexOf(id);
  return at < 0 ? BUILT_IN_ORDER.length + EXPERIMENTAL_THEMES.length : at;
};

/** Parses every built-in theme folder. One that breaks the format is left out and logged. */
export function loadBuiltIns(css: Files = CSS, svgs: Files = SVG, previews: Files = PREVIEW) {
  const entries: ThemeEntry[] = [];
  for (const [path, text] of Object.entries(css)) {
    const id = folderOf(path);
    const own: Partial<Record<GlyphName, string>> = {};
    for (const [svgPath, svg] of Object.entries(svgs)) {
      const name = fileOf(svgPath).replace(/\.svg$/, "");
      if (folderOf(svgPath) === id && isGlyphName(name)) own[name] = svg;
    }
    const preview = Object.entries(previews).find(([p]) => folderOf(p) === id)?.[1] ?? null;
    try {
      entries.push(themeEntry(id, text, true, { svgs: own, preview }));
    } catch (error) {
      console.error(`built-in theme ${id} is broken:`, error);
    }
  }
  return entries.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
