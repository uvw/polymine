/**
 * Light on cells: the shade, the glare, and the rim light a theme lays over
 * its cells, as profiles along the light's direction. The renderer draws
 * them, and the theme tests and the color filter measure the colors they put
 * under each mark.
 */
import { mix } from "./color";
import type { BoardTheme } from "./types";

/** A raised cell is shaded away from the light; a recessed one under its lit edge. */
export type Relief = "raised" | "recessed";

/** A color and how opaque it is, from 0 to 1. */
export interface Tint {
  color: number;
  alpha: number;
}

/** The rim light fades out over this share of the cell from the edges it faces. */
const RIM_REACH = 0.6;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/**
 * How much of the shade covers a point `t` across the cell, from 0 at the lit
 * edge to 1 at the far one. It eases in over the theme's depth.
 */
export function shadeAt(relief: Relief, depth: number, t: number): number {
  const d = Math.max(depth, 1e-3);
  return smoothstep(relief === "raised" ? (t - (1 - d)) / d : (d - t) / d);
}

/** The opaque body of a cell of `base` color at `t`, with its shade mixed in. */
export function bodyAt(board: BoardTheme, base: number, relief: Relief, t: number): number {
  const { color, alpha } = shadeOf(board, relief);
  return mix(base, color, alpha * shadeAt(relief, board.shadeDepth, t));
}

/** The shade of a raised cell or a recessed one, at its darkest. */
export const shadeOf = (board: BoardTheme, relief: Relief): Tint =>
  relief === "raised"
    ? { color: board.shade, alpha: board.shadeAlpha }
    : { color: board.openShade, alpha: board.openShadeAlpha };

/** The glare at `t` across its own span, from its lit end to its far one. */
export function glossAt(board: BoardTheme, t: number): Tint {
  return { color: board.gloss, alpha: board.glossAlpha + (board.glossFade - board.glossAlpha) * t };
}

/** The rim light at `t` across the cell, from the edges it faces. */
export function rimAt(board: BoardTheme, t: number): Tint {
  return { color: board.rim, alpha: board.rimAlpha * (1 - smoothstep(t / RIM_REACH)) };
}

export const hasShade = (board: BoardTheme, relief: Relief) => shadeOf(board, relief).alpha > 0;
export const hasGloss = (board: BoardTheme) => Math.max(board.glossAlpha, board.glossFade) > 0;
export const hasRim = (board: BoardTheme) => board.rimAlpha > 0 && board.rimWidth > 0;

/** Whether the theme sets any light on cells, so the renderer needs its gradients. */
export const hasLight = (board: BoardTheme) =>
  hasShade(board, "raised") || hasShade(board, "recessed") || hasGloss(board) || hasRim(board);

/**
 * What a stack of see-through layers does to any color under it, per 8-bit
 * channel: `channel * keep + add`.
 */
export interface Look {
  keep: number;
  add: readonly [number, number, number];
}

const channels = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as const;

/** The look of `layers` laid over a color in order, the last on top. */
export function look(layers: readonly Tint[]): Look {
  let keep = 1;
  let add = [0, 0, 0];
  for (const { color, alpha } of layers) {
    const c = channels(color);
    add = add.map((a, i) => a * (1 - alpha) + (c[i] ?? 0) * alpha);
    keep *= 1 - alpha;
  }
  return { keep, add: add as [number, number, number] };
}

export const PLAIN: Look = look([]);

/** `hex` under the layers of `l`, as the screen shows it. */
export function seenUnder(hex: number, l: Look): number {
  const out = channels(hex).map((c, i) =>
    Math.max(0, Math.min(255, Math.round(c * l.keep + (l.add[i] ?? 0)))),
  );
  return ((out[0] ?? 0) << 16) | ((out[1] ?? 0) << 8) | (out[2] ?? 0);
}

/** The cell kinds marks sit on: closed cells, open ones, and the opened mine's. */
export type Backdrop = "closed" | "open" | "exploded";

const reliefOf = (kind: Backdrop): Relief => (kind === "closed" ? "raised" : "recessed");

/**
 * The shade over a cell's body at both ends: none at one, all of it at the
 * other. The shade mixes toward one color, so every point between lies
 * between these.
 */
function shadeEnds(board: BoardTheme, kind: Backdrop): Tint[][] {
  const relief = reliefOf(kind);
  return hasShade(board, relief) ? [[], [shadeOf(board, relief)]] : [[]];
}

/** The looks of a cell's body at both ends of its shade, before any glare. */
export const bodyLooks = (board: BoardTheme, kind: Backdrop): Look[] =>
  shadeEnds(board, kind).map((layers) => look(layers));

/**
 * Every look a mark can sit on in a cell of `kind`: each end of the shade,
 * alone and under the glare at its strongest and its faintest. Only closed
 * cells have a glare. The flat sheen stays out, as it does in the theme tests.
 */
export function backdropLooks(board: BoardTheme, kind: Backdrop): Look[] {
  if (kind !== "closed" || !hasGloss(board)) return bodyLooks(board, kind);
  const glares = [...new Set([board.glossAlpha, board.glossFade])].map((alpha) => [
    { color: board.gloss, alpha },
  ]);
  return shadeEnds(board, kind).flatMap((shade) =>
    [[], ...glares].map((glare) => look([...shade, ...glare])),
  );
}

export const baseOf = (board: BoardTheme, kind: Backdrop) => board[kind];

/** Every color a mark can sit on in a cell of `kind`, from `backdropLooks`. */
export const backdrops = (board: BoardTheme, kind: Backdrop): number[] => [
  ...new Set(backdropLooks(board, kind).map((l) => seenUnder(baseOf(board, kind), l))),
];

/** The colors of a cell's body at both ends of its shade, from `bodyLooks`. */
export const bodies = (board: BoardTheme, kind: Backdrop): number[] => [
  ...new Set(bodyLooks(board, kind).map((l) => seenUnder(baseOf(board, kind), l))),
];

const css = ({ color, alpha }: Tint) => {
  const [r, g, b] = channels(color);
  return `rgb(${r} ${g} ${b} / ${+(alpha * 100).toFixed(1)}%)`;
};

/**
 * The cell's light as CSS gradients for a small preview of `kind`, or null
 * when the theme sets none. Built from resolved numbers, never from theme CSS.
 */
export function previewLight(board: BoardTheme, kind: "closed" | "open"): string | null {
  const angle = `${(board.lightAngle + 180) % 360}deg`;
  const pct = (x: number) => `${+(x * 100).toFixed(1)}%`;
  const layers: string[] = [];
  if (kind === "closed" && hasGloss(board)) {
    const end = board.glossExtent;
    const start = css(glossAt(board, 0));
    const fade = css(glossAt(board, 1));
    layers.push(
      `linear-gradient(${angle}, ${start}, ${fade} ${pct(end)}, transparent ${pct(end)})`,
    );
  }
  const relief: Relief = kind === "closed" ? "raised" : "recessed";
  if (hasShade(board, relief)) {
    const shade = shadeOf(board, relief);
    const dark = css(shade);
    const clear = css({ ...shade, alpha: 0 });
    const depth = board.shadeDepth;
    layers.push(
      relief === "raised"
        ? `linear-gradient(${angle}, ${clear} ${pct(1 - depth)}, ${dark})`
        : `linear-gradient(${angle}, ${dark}, ${clear} ${pct(depth)})`,
    );
  }
  return layers.length ? layers.join(", ") : null;
}
