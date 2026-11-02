/**
 * The theme format: what a theme folder holds and what `theme.css` may say.
 * `docs/themes/how-theming-works.md` explains the rules; the player's guide
 * lists every variable.
 */

/** The format this build reads. A theme that declares a newer one is skipped. */
export const FORMAT_VERSION = 1;

/** SVG files that replace a drawn mark or number, by file name without `.svg`. */
export const GLYPHS = [
  "mine",
  "flag",
  "question",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
] as const;
export type GlyphName = (typeof GLYPHS)[number];

/** The most counts a theme can color: some tilings give a cell 14 neighbors. */
export const MAX_NUMBERS = 14;

export type Kind =
  | "color"
  | "plate"
  | "sheen"
  | "opacity"
  | "length"
  | "share"
  | "font"
  | "weight"
  | "spikes"
  | "scheme"
  | "material"
  | "numberStyle"
  | "count"
  | "angle"
  | "glossShape"
  | "effects";

/**
 * Board effects the app ships, as GPU shaders. A theme picks them by name
 * with `--board-effects`. It never carries shader code, which could hang the
 * GPU.
 */
export const BOARD_EFFECTS = ["ferrofluid"] as const;
export type BoardEffect = (typeof BOARD_EFFECTS)[number];

/**
 * Every board variable with its kind and the value a theme gets when it
 * leaves it out. The defaults draw Graphite without the accent tint.
 */
export const VARIABLES = {
  "--color-scheme": { kind: "scheme", fallback: "light dark" },
  "--window-material": { kind: "material", fallback: "default" },
  "--number-style": { kind: "numberStyle", fallback: "digits" },
  "--number-ring-from": { kind: "count", fallback: "none" },
  "--board-effects": { kind: "effects", fallback: "none" },
  "--board-plate": { kind: "plate", fallback: "#14161b" },
  "--board-plate-opacity": { kind: "opacity", fallback: "1" },
  "--board-gap": { kind: "length", fallback: "2px" },
  "--board-font": {
    kind: "font",
    fallback:
      '"Segoe UI Variable Display", "Segoe UI", -apple-system, ui-rounded, system-ui, sans-serif',
  },
  "--board-font-weight": { kind: "weight", fallback: "700" },
  "--cell-rounding": { kind: "share", fallback: "0.22" },
  "--cell-bevel": { kind: "share", fallback: "0.05" },
  "--cell-sheen": { kind: "sheen", fallback: "rgb(255 255 255 / 7%)" },
  "--cell-closed": { kind: "color", fallback: "#667089" },
  "--cell-closed-hover": { kind: "color", fallback: "#737e99" },
  "--cell-closed-pressed": { kind: "color", fallback: "#4e5669" },
  "--cell-closed-edge": { kind: "color", fallback: "#6f7991" },
  "--cell-closed-opacity": { kind: "opacity", fallback: "1" },
  "--cell-open": { kind: "color", fallback: "#1e2128" },
  "--cell-open-edge": { kind: "color", fallback: "#363c48" },
  "--cell-open-opacity": { kind: "opacity", fallback: "1" },
  "--cell-exploded": { kind: "color", fallback: "#d64545" },
  "--cell-light-angle": { kind: "angle", fallback: "0deg" },
  "--cell-gloss": { kind: "color", fallback: "#ffffff" },
  "--cell-gloss-opacity": { kind: "opacity", fallback: "0" },
  "--cell-gloss-fade": { kind: "opacity", fallback: "0" },
  "--cell-gloss-extent": { kind: "share", fallback: "0.5" },
  "--cell-gloss-shape": { kind: "glossShape", fallback: "arc" },
  "--cell-glint-opacity": { kind: "opacity", fallback: "0" },
  "--cell-rim": { kind: "color", fallback: "#ffffff" },
  "--cell-rim-opacity": { kind: "opacity", fallback: "0" },
  "--cell-rim-width": { kind: "length", fallback: "1px" },
  "--cell-rim-angle": { kind: "angle", fallback: "180deg" },
  "--cell-shade": { kind: "color", fallback: "#000000" },
  "--cell-shade-opacity": { kind: "opacity", fallback: "0" },
  "--cell-shade-depth": { kind: "share", fallback: "0.5" },
  "--cell-open-shade": { kind: "color", fallback: "#000000" },
  "--cell-open-shade-opacity": { kind: "opacity", fallback: "0" },
  "--flag": { kind: "color", fallback: "#ff7043" },
  "--flag-outline": { kind: "color", fallback: "#14161b" },
  "--flag-pole": { kind: "color", fallback: "#e6e8ee" },
  "--question": { kind: "color", fallback: "#f0e442" },
  "--question-outline": { kind: "plate", fallback: "none" },
  "--mine": { kind: "color", fallback: "#0e0f12" },
  "--mine-spark": { kind: "color", fallback: "#f07848" },
  "--mine-spikes": { kind: "spikes", fallback: "4" },
  "--icon-plate": { kind: "plate", fallback: "none" },
  "--icon-metal": { kind: "plate", fallback: "none" },
  "--icon-mine": { kind: "plate", fallback: "none" },
  "--icon-spark": { kind: "plate", fallback: "none" },
  "--hint": { kind: "color", fallback: "#56b4e9" },
  "--focus": { kind: "color", fallback: "#ffffff" },
  "--win": { kind: "color", fallback: "#2fc79c" },
  "--number-shadow": { kind: "color", fallback: "#000000" },
  "--number-shadow-opacity": { kind: "opacity", fallback: "0" },
} as const satisfies Record<string, { kind: Kind; fallback: string }>;
export type VariableName = keyof typeof VARIABLES;

/** Number colors a theme gets when it sets none: Graphite's 12. */
export const DEFAULT_NUMBERS = [
  "#56b4e9",
  "#2fc79c",
  "#f07848",
  "#d88cc0",
  "#e9a23b",
  "#f0e442",
  "#b9c3ff",
  "#dfe3ea",
  "#ff8fa3",
  "#8fe3d2",
  "#c7a7ff",
  "#ffc9a8",
] as const;

/** The system accent color, which Polymine sets when the player allows the tint. */
export const SYSTEM_ACCENT = "--system-accent";

/** `--number-1` to `--number-14`. */
export const numberVariable = (n: number) => `--number-${n}`;

/**
 * Window chrome tokens from `app.css` that a theme may set. Any other
 * variable a theme sets stays on the board side, where only the names in
 * `VARIABLES` mean anything.
 */
export const CHROME_TOKENS = [
  "--text",
  "--text-dim",
  "--accent",
  "--accent-hover",
  "--on-accent",
  "--on-menu-highlight",
  "--danger",
  "--warning",
  "--window",
  "--window-image",
  "--control",
  "--control-hover",
  "--control-pressed",
  "--subtle-hover",
  "--subtle-pressed",
  "--stroke",
  "--stroke-strong",
  "--divider",
  "--surface",
  "--layer",
  "--shadow",
  "--accent-image",
] as const;

/** Test checks a built-in theme may relax, named in its `Relaxed:` header line. */
export const RELAXATIONS = [
  "cell-contrast",
  "pane-contrast",
  "number-separation",
  "number-readability",
] as const;
export type Relaxation = (typeof RELAXATIONS)[number];

/**
 * Functions a value may call. Anything else could load a resource, as
 * `url()`, `image-set()`, and `src()` do, or reach outside the theme.
 */
const FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "var",
  "calc",
  "min",
  "max",
  "clamp",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

/** Limits that keep a theme small enough to read and resolve at once. */
export const LIMITS = {
  /** The same limit the shell puts on the file. */
  cssBytes: 32 * 1024,
  declarations: 300,
  nameLength: 64,
  valueLength: 1000,
  themeName: 40,
  author: 80,
  description: 120,
  version: 20,
} as const;

/** What a theme says about itself in its header comment. */
export interface ThemeMeta {
  name: string;
  author: string;
  description: string;
  version: string;
  format: number;
}

/** A parsed `theme.css`: the header, and every variable in source order. */
export interface ThemeSheet {
  meta: ThemeMeta;
  /** Checks this built-in theme relaxes. Always empty for player themes. */
  relaxed: ReadonlySet<Relaxation>;
  /** Variable names to their values as written, the last one winning. */
  declarations: ReadonlyMap<string, string>;
}

/** Why a theme can't be used. The message goes to the log as is. */
export class ThemeError extends Error {
  override name = "ThemeError";
}

const fail = (message: string): never => {
  throw new ThemeError(message);
};

const HEADER_KEYS = ["name", "author", "description", "version", "format"] as const;
const HEADER_LIMITS = {
  name: LIMITS.themeName,
  author: LIMITS.author,
  description: LIMITS.description,
  version: LIMITS.version,
};
const VARIABLE_NAME = /^--[A-Za-z0-9_-]+$/;

/**
 * Reads `theme.css`. Throws a `ThemeError` that names the problem when the
 * file breaks the format: a missing header field, a selector other than
 * `:root`, anything but custom properties, or a value that could load a
 * resource. `builtIn` lets the header relax test checks.
 */
export function parseThemeCss(css: string, builtIn = false): ThemeSheet {
  // UTF-8 never takes fewer bytes than UTF-16 takes units, so the length alone
  // refuses a long file without encoding it.
  if (css.length > LIMITS.cssBytes || new TextEncoder().encode(css).length > LIMITS.cssBytes) {
    fail(`theme.css is larger than ${LIMITS.cssBytes} bytes`);
  }
  if (css.includes("\\")) fail("theme.css may not use backslash escapes");
  const text = css.replace(/^\uFEFF/, "");
  const header = /^\s*\/\*([\s\S]*?)\*\//.exec(text);
  if (!header) fail("theme.css must start with a header comment");
  const { meta, relaxed } = parseHeader(header?.[1] ?? "", builtIn);
  const body = stripComments(text.slice(header?.[0].length ?? 0)).trim();
  const rule = /^:root\s*\{([^{}]*)\}$/.exec(body);
  if (!rule) fail("theme.css must hold one :root { … } rule and nothing else");
  return { meta, relaxed, declarations: parseDeclarations(rule?.[1] ?? "") };
}

function parseHeader(comment: string, builtIn: boolean) {
  const fields = new Map<string, string>();
  for (const raw of comment.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*?\s?/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (match) fields.set((match[1] ?? "").toLowerCase(), (match[2] ?? "").trim());
  }
  for (const key of HEADER_KEYS) {
    if (!fields.get(key)) fail(`the header has no ${key[0]?.toUpperCase()}${key.slice(1)} line`);
  }
  const format = Number(fields.get("format"));
  if (!Number.isInteger(format) || format < 1) fail("the header's Format must be a whole number");
  if (format > FORMAT_VERSION) {
    fail(`the theme needs format ${format}; this build reads ${FORMAT_VERSION}`);
  }
  const text = (key: keyof typeof HEADER_LIMITS) => {
    const value = fields.get(key) ?? "";
    const limit = HEADER_LIMITS[key];
    if (value.length > limit) fail(`the header's ${key} is longer than ${limit} characters`);
    return value;
  };
  const relaxed = new Set<Relaxation>();
  if (builtIn) {
    for (const item of (fields.get("relaxed") ?? "").split(",")) {
      const name = item.trim();
      if (!name) continue;
      if (!(RELAXATIONS as readonly string[]).includes(name)) fail(`unknown relaxation ${name}`);
      relaxed.add(name as Relaxation);
    }
  }
  const meta: ThemeMeta = {
    name: text("name"),
    author: text("author"),
    description: text("description"),
    version: text("version"),
    format,
  };
  return { meta, relaxed };
}

/** `css` without its comments, leaving quoted strings alone. */
function stripComments(css: string): string {
  let out = "";
  for (let i = 0; i < css.length;) {
    const c = css[i] ?? "";
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) fail("a comment is never closed");
      out += " ";
      i = end + 2;
    } else if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      if (end < 0) fail("a quoted string is never closed");
      out += css.slice(i, end + 1);
      i = end + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of splitOutsideStrings(block, ";")) {
    const declaration = part.trim();
    if (!declaration) continue;
    const colon = declaration.indexOf(":");
    if (colon < 0) fail(`"${declaration.slice(0, 40)}" is not a declaration`);
    const name = declaration.slice(0, colon).trim();
    const value = declaration
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ");
    if (!VARIABLE_NAME.test(name)) fail(`${name.slice(0, 40)} is not a custom property`);
    if (name.length > LIMITS.nameLength) fail(`${name.slice(0, 40)}… is too long a name`);
    if (name === SYSTEM_ACCENT) fail(`${SYSTEM_ACCENT} is set by Polymine, not by themes`);
    checkValue(name, value);
    // A later declaration replaces an earlier one, as in CSS.
    declarations.delete(name);
    declarations.set(name, value);
  }
  if (declarations.size > LIMITS.declarations) {
    fail(`theme.css sets more than ${LIMITS.declarations} variables`);
  }
  return declarations;
}

function splitOutsideStrings(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * The first function `value` calls that themes can't use, as written; `""` for
 * a `(` right after another value, since `var(--u)(x)` becomes `url(x)` once
 * `--u` is `url`; or null when every call is allowed. A bare `(` after a space,
 * an operator, a comma, or another `(` is grouping, as in `calc((1px + 2px) * 2)`.
 */
export function forbiddenCall(value: string): string | null {
  for (const match of value.matchAll(/([\p{L}\p{N}_-]*)\(/gu)) {
    const fn = match[1] ?? "";
    if (fn === "") {
      const before = value[(match.index ?? 0) - 1];
      if (before === undefined || /[\s(,/*+]/.test(before)) continue;
      return "";
    }
    if (!FUNCTIONS.has(fn.toLowerCase())) return fn;
  }
  return null;
}

/** Rejects values that could load a resource or break out of the declaration. */
function checkValue(name: string, value: string): void {
  if (!value) fail(`${name} has no value`);
  if (value.length > LIMITS.valueLength) fail(`${name} is longer than ${LIMITS.valueLength}`);
  const unquoted = value.replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  if (/["'\n]/.test(unquoted.replace(/""/g, ""))) fail(`${name} has a broken quoted string`);
  if (/[@{}<>!]/.test(unquoted)) fail(`${name} uses a character values can't hold`);
  const call = forbiddenCall(unquoted);
  if (call !== null) {
    fail(
      call
        ? `${name} calls ${call}(), which themes can't use`
        : `${name} opens a parenthesis right after another value`,
    );
  }
  let depth = 0;
  for (const c of unquoted) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (depth < 0) break;
  }
  if (depth !== 0) fail(`${name} has unbalanced parentheses`);
}
