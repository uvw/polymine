/**
 * Turns a theme's variables into the values the renderer and the chrome use,
 * for the current accent color and light or dark mode.
 */
import { evaluateColor, substitute, toHex, type Rgba } from "./css";
import {
  BOARD_EFFECTS,
  CHROME_TOKENS,
  DEFAULT_NUMBERS,
  MAX_NUMBERS,
  SYSTEM_ACCENT,
  VARIABLES,
  forbiddenCall,
  numberVariable,
  type BoardEffect,
  type Kind,
  type VariableName,
} from "./format";
import type { BoardTheme, GlossShape, NumberStyle, Theme, ThemeEntry } from "./types";

/** What a theme resolves against. */
export interface ThemeEnv {
  /** The system accent color, or null when there is none or the player turned the tint off. */
  accent: number | null;
  /** Whether the system is in dark mode. */
  dark: boolean;
}

/**
 * Resolves the named color variables in `declarations` for a light or dark
 * scheme and an accent. Null marks a value that isn't a color.
 */
export type ColorLookup = (
  declarations: ReadonlyMap<string, string>,
  names: readonly string[],
  scheme: { dark: boolean; accent: number | null },
) => Map<string, Rgba | null>;

const hexCss = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** Colors read without a browser, for tests and for engines without `color-mix()`. */
export const staticColors: ColorLookup = (declarations, names, { dark, accent }) => {
  const lookup = (name: string) =>
    name === SYSTEM_ACCENT
      ? accent === null
        ? undefined
        : hexCss(accent)
      : declarations.get(name);
  const out = new Map<string, Rgba | null>();
  for (const name of names) {
    const value = substitute(`var(${name})`, lookup);
    out.set(name, value === null ? null : evaluateColor(value, dark));
  }
  return out;
};

/**
 * Each named variable's `color` as the browser computes it, or null when the
 * variable isn't a color.
 */
function computedColors(
  declarations: ReadonlyMap<string, string>,
  names: readonly string[],
  { dark, accent }: { dark: boolean; accent: number | null },
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const frame = probeFrame();
  if (!frame) return out;
  const { host, probe, view } = frame;
  host.removeAttribute("style");
  host.style.colorScheme = dark ? "dark" : "light";
  host.style.color = SENTINEL;
  for (const [name, value] of declarations) host.style.setProperty(name, value);
  if (accent !== null) host.style.setProperty(SYSTEM_ACCENT, hexCss(accent));
  const sentinel = view.getComputedStyle(host).color;
  for (const name of names) {
    probe.style.color = `var(${name})`;
    const computed = view.getComputedStyle(probe).color;
    // An invalid or missing variable leaves the probe with its parent's color.
    out.set(name, computed === sentinel ? null : computed);
  }
  return out;
}

/** Colors as the browser computes them on a hidden element. */
export const domColors: ColorLookup = (declarations, names, scheme) => {
  const out = new Map<string, Rgba | null>();
  for (const [name, css] of computedColors(declarations, names, scheme)) {
    out.set(name, css === null ? null : (evaluateColor(css, scheme.dark) ?? painted(css)));
  }
  return out;
};

/**
 * Colors the app reads itself, exactly and as the tests do, and the browser's
 * for the rest, such as `oklch()` or `color-mix(in oklab, …)`.
 */
export const browserColors: ColorLookup = (declarations, names, scheme) => {
  const out = staticColors(declarations, names, scheme);
  const rest = names.filter((name) => out.get(name) === null);
  if (rest.length > 0) {
    for (const [name, color] of domColors(declarations, rest, scheme)) out.set(name, color);
  }
  return out;
};

const HIDDEN: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  left: "-100px",
  top: "0",
  width: "0",
  height: "0",
  border: "0",
  visibility: "hidden",
  pointerEvents: "none",
};

/** Any color the probe inherits only when the variable fails. */
const SENTINEL = "rgb(1, 2, 3)";

let frame: {
  iframe: HTMLIFrameElement;
  host: HTMLElement;
  probe: HTMLElement;
  view: Window;
} | null = null;

/**
 * The probe sits in an empty frame, so a theme sees only its own variables
 * and `--system-accent`, never the app's tokens or its stylesheet.
 */
function probeFrame() {
  if (frame?.iframe.isConnected) return frame;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, HIDDEN);
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const view = iframe.contentWindow;
  if (!doc?.body || !view) return null;
  const host = doc.createElement("div");
  const probe = doc.createElement("span");
  host.appendChild(probe);
  doc.body.appendChild(host);
  frame = { iframe, host, probe, view };
  return frame;
}

let paintContext: CanvasRenderingContext2D | null | undefined;

/**
 * A computed color in a space `evaluateColor` doesn't read, such as `oklch()`,
 * converted to sRGB by painting one pixel.
 */
function painted(css: string): Rgba | null {
  if (paintContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    paintContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  const context = paintContext;
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

/**
 * The browser's resolver when it computes `var()` and `color-mix()`, which
 * jsdom doesn't, and the static one otherwise.
 */
export function defaultColors(): ColorLookup {
  if (typeof document === "undefined") return staticColors;
  const test = new Map([["--test", `color-mix(in srgb, #000000, var(${SYSTEM_ACCENT}))`]]);
  const css = computedColors(test, ["--test"], { dark: false, accent: 0xffffff }).get("--test");
  const gray = css ? evaluateColor(css, false) : null;
  return gray && Math.round(gray.r) === 128 ? browserColors : staticColors;
}

const KEYWORDS = {
  scheme: { "light dark": "system", "dark light": "system", light: "light", dark: "dark" },
  material: { default: "default", frosted: "frosted", none: "none" },
  numberStyle: { digits: "digits", colors: "colors" },
  glossShape: { band: "band", arc: "arc", spot: "spot" },
} as const;

/** Degrees in one of each CSS angle unit. */
const ANGLE_UNITS: Record<string, number> = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 };

/** A number, or a percentage of 1. */
function fraction(text: string): number | null {
  const match = /^(\d*\.?\d+)(%?)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) / (match[2] ? 100 : 1);
}

const WEIGHTS: Record<string, string> = { normal: "400", bold: "700" };

/** Parses a value that isn't a color; null when it doesn't fit the kind. */
function parseValue(kind: Kind, text: string): string | number | null {
  const value = text.trim();
  switch (kind) {
    case "scheme":
    case "material":
    case "numberStyle":
    case "glossShape": {
      const table: Record<string, string> = KEYWORDS[kind];
      return table[value.toLowerCase().replace(/\s+/g, " ")] ?? null;
    }
    case "opacity":
    case "share": {
      const n = fraction(value);
      return n !== null && n <= 1 ? n : null;
    }
    case "length": {
      const match = /^(\d*\.?\d+)(px)?$/.exec(value);
      const n = match ? Number(match[1]) : NaN;
      return match && (match[2] || n === 0) && n <= 16 ? n : null;
    }
    case "spikes": {
      const n = Number(value);
      return /^\d+$/.test(value) && n <= 12 ? n : null;
    }
    case "weight": {
      const named = WEIGHTS[value.toLowerCase()];
      if (named) return named;
      const n = Number(value);
      return /^\d00$/.test(value) && n >= 100 && n <= 900 ? value : null;
    }
    case "font":
      return /^[\w\s"',.-]+$/.test(value) ? value : null;
    case "angle": {
      const match = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/i.exec(value);
      const n = match ? Number(match[1]) : NaN;
      const unit = match?.[2]?.toLowerCase();
      if (!match || (!unit && n !== 0)) return null;
      const degrees = n * (unit ? (ANGLE_UNITS[unit] ?? 1) : 1);
      return ((degrees % 360) + 360) % 360;
    }
    case "effects": {
      // Names separated by spaces, each one the app ships, or `none`.
      const names = value.toLowerCase().split(/\s+/);
      if (names.length === 1 && names[0] === "none") return "";
      const known = names.every((name) => (BOARD_EFFECTS as readonly string[]).includes(name));
      return known && new Set(names).size === names.length ? names.join(" ") : null;
    }
    case "count": {
      if (value.toLowerCase() === "none") return "none";
      const n = Number(value);
      return /^\d+$/.test(value) && n >= 1 && n <= MAX_NUMBERS ? n : null;
    }
    default:
      return null;
  }
}

/** The effect names a parsed `--board-effects` holds, in order. */
const effectList = (names: string): BoardEffect[] =>
  names ? (names.split(" ") as BoardEffect[]) : [];

/** Kinds of variable that hold a color. */
const COLOR_KINDS: readonly Kind[] = ["color", "plate", "sheen"];

const NUMBER_VARIABLE = /^--number-(\d+)$/;

/**
 * `entry`'s variables over the defaults. Number colors come from the theme
 * when it sets `--number-1`, and all from the defaults when it doesn't.
 */
function withDefaults(entry: ThemeEntry, warn: (message: string) => void): Map<string, string> {
  const own = entry.sheet.declarations;
  const ownNumbers = own.has(numberVariable(1));
  const merged = new Map<string, string>();
  for (const [name, { fallback }] of Object.entries(VARIABLES)) merged.set(name, fallback);
  if (!ownNumbers) DEFAULT_NUMBERS.forEach((color, i) => merged.set(numberVariable(i + 1), color));
  let ignored = false;
  for (const [name, value] of own) {
    if (!ownNumbers && NUMBER_VARIABLE.test(name)) ignored = true;
    else merged.set(name, value);
  }
  if (ignored) warn("number colors start at --number-1, so the others are ignored");
  return merged;
}

/** How many count colors the theme has: `--number-1` up to the first gap. */
function numberCount(declarations: ReadonlyMap<string, string>): number {
  let n = 0;
  while (n < MAX_NUMBERS && declarations.has(numberVariable(n + 1))) n++;
  return n;
}

/**
 * Resolves `entry` for `env`. A variable whose value doesn't fit falls back
 * to its default, and `warn` hears about it.
 */
export function resolveTheme(
  entry: ThemeEntry,
  env: ThemeEnv,
  colors: ColorLookup = defaultColors(),
  warn: (message: string) => void = () => {},
): Theme {
  const declarations = withDefaults(entry, warn);
  const own = entry.sheet.declarations;
  const lookup = (name: string) => declarations.get(name);

  const plain = <T extends string | number>(name: VariableName): T => {
    const { kind, fallback } = VARIABLES[name];
    const text = substitute(declarations.get(name) ?? fallback, lookup);
    const value = text === null ? null : parseValue(kind, text);
    if (value === null) {
      warn(`${name} has a value this build can't use, so it takes the default`);
      return parseValue(kind, fallback) as T;
    }
    return value as T;
  };

  const scheme = plain<Theme["scheme"]>("--color-scheme");
  const dark = scheme === "system" ? env.dark : scheme === "dark";
  /** Whether a color that may be `none`, as the plate may, is. */
  const none = (name: VariableName) =>
    VARIABLES[name].kind === "plate" &&
    substitute(declarations.get(name) ?? "", lookup)?.trim() === "none";

  const count = numberCount(declarations);
  const beyond = (name: string) => Number(NUMBER_VARIABLE.exec(name)?.[1]) > count;
  if (own.has(numberVariable(1)) && [...own.keys()].some(beyond)) {
    warn(
      count === MAX_NUMBERS
        ? `number colors end at --number-${MAX_NUMBERS}, so the others are ignored`
        : `number colors stop before --number-${count + 1}, the first one missing`,
    );
  }
  const numberNames = Array.from({ length: count }, (_, i) => numberVariable(i + 1));
  const colorNames = (Object.keys(VARIABLES) as VariableName[]).filter(
    (name) => COLOR_KINDS.includes(VARIABLES[name].kind) && !none(name),
  );
  const resolved = colors(declarations, [...colorNames, ...numberNames], {
    dark,
    accent: env.accent,
  });

  const color = (name: string, fallback: string, alpha = false): Rgba => {
    const value = resolved.get(name);
    if (!value) {
      warn(`${name} is not a color this build can read, so it takes the default`);
      return evaluateColor(fallback, dark) as Rgba;
    }
    if (!alpha && value.a < 1) warn(`${name} is see-through; board colors are opaque, so it isn't`);
    return value;
  };
  const opaque = (name: VariableName) => toHex(color(name, VARIABLES[name].fallback));
  const sheen = color("--cell-sheen", VARIABLES["--cell-sheen"].fallback, true);
  const ringFrom = plain<number | "none">("--number-ring-from");

  const board: BoardTheme = {
    plate: none("--board-plate") ? null : opaque("--board-plate"),
    plateAlpha: plain("--board-plate-opacity"),
    closed: opaque("--cell-closed"),
    closedHover: opaque("--cell-closed-hover"),
    closedPressed: opaque("--cell-closed-pressed"),
    closedEdge: opaque("--cell-closed-edge"),
    closedAlpha: plain("--cell-closed-opacity"),
    sheen: toHex(sheen),
    sheenAlpha: sheen.a,
    bevel: plain("--cell-bevel"),
    open: opaque("--cell-open"),
    openEdge: opaque("--cell-open-edge"),
    openAlpha: plain("--cell-open-opacity"),
    exploded: opaque("--cell-exploded"),
    lightAngle: plain("--cell-light-angle"),
    gloss: opaque("--cell-gloss"),
    glossAlpha: plain("--cell-gloss-opacity"),
    glossFade: plain("--cell-gloss-fade"),
    glossExtent: plain("--cell-gloss-extent"),
    glossShape: plain<GlossShape>("--cell-gloss-shape"),
    glintAlpha: plain("--cell-glint-opacity"),
    rim: opaque("--cell-rim"),
    rimAlpha: plain("--cell-rim-opacity"),
    rimWidth: plain("--cell-rim-width"),
    rimAngle: plain("--cell-rim-angle"),
    shade: opaque("--cell-shade"),
    shadeAlpha: plain("--cell-shade-opacity"),
    openShade: opaque("--cell-open-shade"),
    openShadeAlpha: plain("--cell-open-shade-opacity"),
    shadeDepth: plain("--cell-shade-depth"),
    flag: opaque("--flag"),
    flagOutline: opaque("--flag-outline"),
    flagPole: opaque("--flag-pole"),
    question: opaque("--question"),
    questionOutline: none("--question-outline") ? null : opaque("--question-outline"),
    mine: opaque("--mine"),
    mineSpark: opaque("--mine-spark"),
    mineSpikes: plain("--mine-spikes"),
    hint: opaque("--hint"),
    focus: opaque("--focus"),
    win: opaque("--win"),
    numbers: numberNames.map((name, i) =>
      toHex(color(name, DEFAULT_NUMBERS[i % DEFAULT_NUMBERS.length] ?? "#ffffff")),
    ),
    numberStyle: plain<NumberStyle>("--number-style"),
    numberRingFrom: ringFrom === "none" ? null : ringFrom,
    numberShadow: opaque("--number-shadow"),
    numberShadowAlpha: plain("--number-shadow-opacity"),
    fontFamily: plain("--board-font"),
    fontWeight: plain("--board-font-weight"),
    gap: plain("--board-gap"),
    rounding: plain("--cell-rounding"),
    glyphs: entry.glyphs,
    filter: null,
    effects: effectList(plain<string>("--board-effects")),
  };

  const optional = (name: VariableName) => (none(name) ? null : opaque(name));

  return {
    id: entry.id,
    meta: entry.sheet.meta,
    relaxed: entry.sheet.relaxed,
    scheme,
    material: plain("--window-material"),
    chrome: chromeTokens(own, declarations, warn),
    board,
    icon: {
      dark,
      plate: optional("--icon-plate"),
      metal: optional("--icon-metal"),
      mine: optional("--icon-mine"),
      spark: optional("--icon-spark"),
    },
    preview: entry.preview,
  };
}

/**
 * The chrome tokens the theme sets, with its own variables filled in. A
 * reference to anything else, such as `--system-accent` or another chrome
 * token, stays for the browser to resolve on `<html>`.
 */
function chromeTokens(
  own: ReadonlyMap<string, string>,
  declarations: ReadonlyMap<string, string>,
  warn: (message: string) => void,
): Record<string, string> {
  const chrome: Record<string, string> = {};
  const tokens = new Set<string>(CHROME_TOKENS);
  const lookup = (name: string) => (tokens.has(name) ? undefined : declarations.get(name));
  for (const token of CHROME_TOKENS) {
    const value = own.get(token);
    if (value === undefined) continue;
    const filled = substitute(value, lookup, true);
    if (filled === null) warn(`${token} refers to a variable in a loop`);
    // Every value passed the parser alone; joined, they get the same check again.
    else if (forbiddenCall(filled) !== null) warn(`${token} builds a call themes can't use`);
    else chrome[token] = filled;
  }
  return chrome;
}
