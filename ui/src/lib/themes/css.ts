/**
 * CSS values in theme files: `var()` substitution, and colors read without a
 * browser. `evaluateColor` covers what the built-in themes write, so the theme
 * tests can run in Node, and parses the colors the browser computes. The app
 * hands any other color to a hidden element (see `resolve.ts`).
 */

/** A color with channels from 0 to 255 and alpha from 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** How deep `var()` references may nest before a cycle is assumed. */
const MAX_DEPTH = 16;

/**
 * `value` with each `var(--name, fallback)` replaced by the value `lookup`
 * gives for the name, substituted in turn. A name `lookup` doesn't know takes
 * its fallback, or stays as written when `keepUnknown` is set, for references
 * the browser fills in later. Returns null for a reference that can't be
 * filled.
 */
export function substitute(
  value: string,
  lookup: (name: string) => string | undefined,
  keepUnknown = false,
  depth = 0,
): string | null {
  if (depth > MAX_DEPTH) return null;
  let out = "";
  let i = 0;
  for (let at = value.indexOf("var(", i); at >= 0; at = value.indexOf("var(", i)) {
    const end = closingParen(value, at + 3);
    if (end < 0) return null;
    out += value.slice(i, at);
    const [name = "", fallback] = splitTop(value.slice(at + 4, end), ",", 2);
    const known = lookup(name.trim());
    let replaced: string | null;
    if (known !== undefined) {
      replaced = substitute(known, lookup, keepUnknown, depth + 1);
    } else if (keepUnknown) {
      replaced =
        fallback === undefined
          ? value.slice(at, end + 1)
          : `var(${name.trim()}, ${substitute(fallback.trim(), lookup, true, depth + 1)})`;
    } else {
      replaced =
        fallback === undefined ? null : substitute(fallback.trim(), lookup, false, depth + 1);
    }
    if (replaced === null) return null;
    out += replaced;
    i = end + 1;
  }
  return out + value.slice(i);
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** `text` split at `separator` outside parentheses, into at most `limit` parts. */
export function splitTop(text: string, separator: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length && parts.length < limit - 1; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

/**
 * Reads a color written as hex, `rgb()`, `rgba()`, `color(srgb …)`,
 * `light-dark()`, `color-mix(in srgb, …)`, or one of `transparent`, `black`,
 * and `white`, with `var()` already substituted. Returns null for anything
 * else, which the browser has to resolve.
 */
export function evaluateColor(text: string, dark: boolean): Rgba | null {
  const value = text.trim().toLowerCase();
  const named = NAMED[value];
  if (named) return { ...named };
  if (value.startsWith("#")) return hex(value.slice(1));
  const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(value);
  if (!call) return null;
  const args = call[2] ?? "";
  switch (call[1]) {
    case "rgb":
    case "rgba":
      return rgb(args);
    case "color":
      return srgb(args);
    case "light-dark": {
      const parts = splitTop(args, ",");
      if (parts.length !== 2) return null;
      return evaluateColor((dark ? parts[1] : parts[0]) ?? "", dark);
    }
    case "color-mix":
      return colorMix(args, dark);
    default:
      return null;
  }
}

function hex(digits: string): Rgba | null {
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  const full =
    digits.length === 3 || digits.length === 4
      ? [...digits].map((d) => d + d).join("")
      : digits.length === 6 || digits.length === 8
        ? digits
        : null;
  if (!full) return null;
  const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) / 255 : 1 };
}

/** A number, or a percentage of `whole`. */
function amount(text: string, whole: number): number | null {
  const match = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] ? (n / 100) * whole : n;
}

/** The channels and alpha of `rgb()`, in the comma or the space syntax. */
function rgb(args: string): Rgba | null {
  const commas = args.split(",").map((s) => s.trim());
  let channels: string[];
  let alpha: string | undefined;
  if (commas.length >= 3) {
    channels = commas.slice(0, 3);
    alpha = commas[3];
    if (commas.length > 4) return null;
  } else {
    const [main = "", slash] = args.split("/");
    channels = main.trim().split(/\s+/);
    alpha = slash;
  }
  return channelsToRgba(channels, alpha, 255);
}

/** `color(srgb r g b / a)`, with channels from 0 to 1. */
function srgb(args: string): Rgba | null {
  const [main = "", slash] = args.split("/");
  const [space, ...channels] = main.trim().split(/\s+/);
  if (space !== "srgb") return null;
  const color = channelsToRgba(channels, slash, 1);
  // Browsers print these channels to about six digits; snapping to a
  // thousandth of a level rounds a mix that lands on .5 the way `mix()` does.
  const level = (v: number) => Math.round(v * 255 * 1000) / 1000;
  return color && { ...color, r: level(color.r), g: level(color.g), b: level(color.b) };
}

function channelsToRgba(channels: string[], alpha: string | undefined, whole: number) {
  if (channels.length !== 3) return null;
  const [r, g, b] = channels.map((c) => amount(c, whole));
  const a = alpha === undefined ? 1 : amount(alpha, 1);
  if (r == null || g == null || b == null || a == null) return null;
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

/** A `color-mix()` stop: the color and its percentage, in either order. */
function stop(text: string, dark: boolean) {
  const trimmed = text.trim();
  const after = /^([\s\S]*?)\s+(\d*\.?\d+)%$/.exec(trimmed);
  const before = /^(\d*\.?\d+)%\s+([\s\S]*)$/.exec(trimmed);
  const [color, percent] = after
    ? [after[1], Number(after[2])]
    : before
      ? [before[2], Number(before[1])]
      : [trimmed, undefined];
  return { color: evaluateColor(color ?? "", dark), percent };
}

/**
 * `color-mix(in srgb, …)` as CSS Color 5 defines it: percentages normalized
 * to 100%, a sum below 100% scaling the alpha, and premultiplied alpha.
 */
function colorMix(args: string, dark: boolean): Rgba | null {
  const [space, first, second] = splitTop(args, ",");
  if (space?.trim() !== "in srgb" || first === undefined || second === undefined) return null;
  const a = stop(first, dark);
  const b = stop(second, dark);
  if (!a.color || !b.color) return null;
  const p1 = a.percent ?? (b.percent === undefined ? 50 : 100 - b.percent);
  const p2 = b.percent ?? 100 - p1;
  const sum = p1 + p2;
  if (p1 < 0 || p2 < 0 || sum <= 0) return null;
  const w2 = p2 / sum;
  const w1 = 1 - w2;
  const alpha = a.color.a * w1 + b.color.a * w2;
  const scale = Math.min(1, sum / 100);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  // With both opaque this is `x + (y - x) * t`, the same arithmetic as
  // `mix()` in `color.ts`, so opaque mixes round to the same channels.
  const channel = (x: number, y: number) =>
    a.color?.a === 1 && b.color?.a === 1
      ? x + (y - x) * w2
      : (x * (a.color?.a ?? 0) * w1 + y * (b.color?.a ?? 0) * w2) / alpha;
  return {
    r: channel(a.color.r, b.color.r),
    g: channel(a.color.g, b.color.g),
    b: channel(a.color.b, b.color.b),
    a: alpha * scale,
  };
}

/** `color` as 0xRRGGBB, ignoring alpha. */
export function toHex(color: Rgba): number {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return (c(color.r) << 16) | (c(color.g) << 8) | c(color.b);
}
