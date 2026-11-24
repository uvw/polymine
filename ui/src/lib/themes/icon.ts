/** The app icon drawn in a theme's colors: the realistic mine on a plate. */

import { cssColor, linear, luminance, mix } from "./color";
import type { Theme } from "./types";

const WHITE = 0xffffff;
/** Neutral plates for a theme whose board is the wrong shade for the mode. */
const LIGHT_PLATE = 0xf3f5f8;
const DARK_PLATE = 0x0f1115;
/** Relative luminance above which a plate reads as light. */
const LIGHT_FROM = 0.18;

export interface IconColors {
  plate: number;
  metal: number;
  mine: number;
  spark: number;
}

/**
 * The icon's colors: the theme's `--icon-*` variables where it sets them, the
 * board's otherwise. Many themes keep a dark board in light mode, so a plate
 * that doesn't match the mode turns to a neutral one tinted by the closed cell.
 */
export function iconColors(theme: Theme): IconColors {
  const { board, icon } = theme;
  const base = board.plate ?? board.open;
  const light = luminance(linear(base)) > LIGHT_FROM;
  const fitting = light !== icon.dark;
  return {
    plate:
      icon.plate ??
      (fitting ? base : mix(icon.dark ? DARK_PLATE : LIGHT_PLATE, board.closed, 0.15)),
    metal: icon.metal ?? board.closed,
    mine: icon.mine ?? board.mine,
    spark: icon.spark ?? board.mineSpark,
  };
}

const f = (n: number) => n.toFixed(2);
const stop = (offset: number, color: number, opacity = 1) =>
  `<stop offset="${offset}" stop-color="${cssColor(color)}" stop-opacity="${opacity}"/>`;

/** Triangles behind the mine, standing for the tilings. */
function lattice(color: number): string {
  const h = (10 * Math.sqrt(3)) / 2;
  const paths: string[] = [];
  for (let row = -1; row < 13; row++) {
    for (let col = -1; col < 12; col++) {
      const x = col * 10 + (row % 2 ? 5 : 0);
      paths.push(`M${f(x)} ${f(row * h)}l10 0l-5 ${f(h)}z`);
    }
  }
  return `<path d="${paths.join("")}" fill="none" stroke="${cssColor(color)}" stroke-width="0.6" opacity="0.5"/>`;
}

/** The icon as a standalone SVG on a 100 by 100 view box. */
export function iconSvg(c: IconColors, options: { lattice?: boolean } = {}): string {
  const spikeTop = mix(0xc4cad4, c.metal, 0.35);
  const spikeBottom = mix(0x4a505b, c.metal, 0.35);
  const cap = mix(0x6a707b, c.metal, 0.35);
  const lines: string[] = [];
  const caps: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const [x2, y2] = [50 + 33 * cos, 50 + 33 * sin];
    lines.push(
      `<line x1="${f(50 + 18 * cos)}" y1="${f(50 + 18 * sin)}" x2="${f(x2)}" y2="${f(y2)}" stroke="url(#sp)" stroke-width="7" stroke-linecap="round"/>`,
    );
    // The spike toward the top right carries the spark.
    const lit = k === 7;
    caps.push(
      `<circle cx="${f(x2)}" cy="${f(y2)}" r="3.6" fill="${cssColor(lit ? c.spark : cap)}"/>`,
    );
    if (lit) caps.push(`<circle cx="${f(x2)}" cy="${f(y2)}" r="9" fill="url(#sk)"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>\
<linearGradient id="pl" x1="0" y1="0" x2="0" y2="1">${stop(0, mix(c.plate, c.metal, 0.3))}${stop(1, c.plate)}</linearGradient>\
<radialGradient id="ha" cx="0.5" cy="0.5" r="0.5">${stop(0, mix(c.metal, WHITE, 0.45), 0.4)}${stop(1, mix(c.metal, WHITE, 0.45), 0)}</radialGradient>\
<radialGradient id="ba" cx="0.38" cy="0.35" r="0.75">${stop(0, mix(c.mine, WHITE, 0.55))}${stop(0.35, mix(c.mine, WHITE, 0.12))}${stop(1, c.mine)}</radialGradient>\
<linearGradient id="sp" x1="0" y1="0" x2="1" y2="1">${stop(0, spikeTop)}${stop(1, spikeBottom)}</linearGradient>\
<radialGradient id="sh" cx="0.5" cy="0.5" r="0.5">${stop(0, 0, 0.6)}${stop(1, 0, 0)}</radialGradient>\
<radialGradient id="sk" cx="0.5" cy="0.5" r="0.5">${stop(0, c.spark, 0.9)}${stop(1, c.spark, 0)}</radialGradient>\
<clipPath id="cl"><rect x="4" y="4" width="92" height="92" rx="20"/></clipPath></defs>\
<rect x="4" y="4" width="92" height="92" rx="20" fill="url(#pl)"/>\
<g clip-path="url(#cl)">${options.lattice ? lattice(mix(c.metal, c.plate, 0.25)) : ""}<circle cx="50" cy="50" r="40" fill="url(#ha)"/></g>\
<rect x="5" y="5" width="90" height="90" rx="19" fill="none" stroke="${cssColor(mix(c.metal, WHITE, 0.3))}" stroke-opacity="0.6" stroke-width="1.5"/>\
<ellipse cx="52" cy="79" rx="26" ry="6" fill="url(#sh)"/>${lines.join("")}${caps.join("")}\
<circle cx="50" cy="50" r="22" fill="url(#ba)"/>\
<circle cx="50" cy="50" r="21.3" fill="none" stroke="${cssColor(mix(c.metal, WHITE, 0.5))}" stroke-opacity="0.8" stroke-width="1.2"/>\
<ellipse cx="42" cy="40" rx="7" ry="4.5" fill="#fff" opacity="0.6" transform="rotate(-30 42 40)"/></svg>`;
}

/** A canvas with `svg` drawn on it at `size` by `size` pixels, or null without a 2D canvas. */
async function drawIcon(
  svg: string,
  size: number,
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null> {
  const image = new Image(size, size);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  return { canvas, context };
}

/** `svg` drawn at `size` by `size` pixels, as RGBA bytes, or null without a 2D canvas. */
export async function iconPixels(svg: string, size: number): Promise<Uint8Array | null> {
  const drawn = await drawIcon(svg, size);
  if (!drawn) return null;
  return new Uint8Array(drawn.context.getImageData(0, 0, size, size).data.buffer);
}

/** `svg` drawn at `size` by `size` pixels, as a PNG file, or null without a 2D canvas. */
export async function iconPng(svg: string, size: number): Promise<Uint8Array | null> {
  const drawn = await drawIcon(svg, size);
  if (!drawn) return null;
  const blob = await new Promise<Blob | null>((resolve) =>
    drawn.canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
