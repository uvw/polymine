/**
 * The theme's light on cells, drawn from one gradient texture. Each row holds
 * one profile along the light's direction, from the lit edge to the far one,
 * and a matrix per shape lays a row across that shape. Every shape in every
 * tiling shares the texture, so the cells' draws stay in the same batches.
 */
import { BufferImageSource, Matrix, Texture, type FillStyle } from "pixi.js";
import type { Point } from "../bindings";
import { bodyAt, glossAt, rimAt, type Tint } from "../themes/gloss";
import type { BoardTheme } from "../themes/types";
import {
  across,
  circle,
  extent,
  halfPlane,
  intersectConvex,
  toward,
  type ClippedPoint,
} from "./geometry";

export const ROWS = [
  "closed",
  "closedHover",
  "closedPressed",
  "open",
  "exploded",
  "gloss",
  "rim",
] as const;
export type Row = (typeof ROWS)[number];

/** Texels along each profile; the GPU blends between them. */
const WIDTH = 256;
/** Texel rows per profile. Sampling the middle of four equal rows never blends in a neighbor. */
const ROW_HEIGHT = 4;

/** Each row's profile, from 0 at its start to 1 at its end. */
function profile(board: BoardTheme, row: Row): (t: number) => Tint {
  const body = (base: number, relief: "raised" | "recessed") => (t: number) => ({
    color: bodyAt(board, base, relief, t),
    alpha: 1,
  });
  switch (row) {
    case "closed":
      return body(board.closed, "raised");
    case "closedHover":
      return body(board.closedHover, "raised");
    // A pressed cell is pushed in, so it takes the open cells' shade.
    case "closedPressed":
      return body(board.closedPressed, "recessed");
    case "open":
      return body(board.open, "recessed");
    case "exploded":
      return body(board.exploded, "recessed");
    case "gloss":
      return (t) => glossAt(board, t);
    case "rim":
      return (t) => rimAt(board, t);
  }
}

/** The texture's pixels, premultiplied. The first and last texels pad each end. */
export function lightPixels(board: BoardTheme): Uint8Array {
  const pixels = new Uint8Array(WIDTH * ROW_HEIGHT * ROWS.length * 4);
  ROWS.forEach((row, r) => {
    const at = profile(board, row);
    for (let i = 0; i < WIDTH; i++) {
      const t = Math.max(0, Math.min(1, (i - 0.5) / (WIDTH - 2)));
      const { color, alpha } = at(t);
      const rgba = [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((c) =>
        Math.round(c * alpha),
      );
      rgba.push(Math.round(alpha * 255));
      for (let y = 0; y < ROW_HEIGHT; y++) {
        pixels.set(rgba, ((r * ROW_HEIGHT + y) * WIDTH + i) * 4);
      }
    }
  });
  return pixels;
}

export class LightAtlas {
  readonly texture: Texture;

  constructor(board: BoardTheme) {
    const source = new BufferImageSource({
      resource: lightPixels(board),
      width: WIDTH,
      height: ROW_HEIGHT * ROWS.length,
      alphaMode: "premultiplied-alpha",
    });
    this.texture = new Texture({ source });
  }

  destroy(): void {
    this.texture.destroy(true);
  }

  /**
   * A fill or stroke that lays `row` across `points`, from the edge facing a
   * light at `degrees` to the far edge. Points are in the drawing's own
   * pixels, which Pixi calls global space for a fill without a transform.
   */
  style(row: Row, points: readonly Point[], degrees: number): FillStyle {
    const light = toward(degrees);
    const side = across(light);
    const [lo, hi] = extent(points, light);
    const [near, far] = extent(points, side);
    const k = (WIDTH - 2) / Math.max(hi - lo, 1e-6);
    // Along the light, x runs over the row; across it, y barely moves, so the
    // map stays invertible while every point samples the middle of its row.
    const lean = 0.25 / Math.max(Math.abs(near), Math.abs(far), 1);
    const toTexels = new Matrix(
      -light.x * k,
      side.x * lean,
      -light.y * k,
      side.y * lean,
      1 + hi * k,
      ROWS.indexOf(row) * ROW_HEIGHT + ROW_HEIGHT / 2,
    );
    return { texture: this.texture, matrix: toTexels.invert(), textureSpace: "global" };
  }
}

/** How far an arc glare's lower edge bows into the cell, as a share of the glare's depth. */
const ARC_BOW = 0.45;
/** Corners of the circle an arc or a spot glare is cut by. */
const CIRCLE_SIDES = 96;

/**
 * The glare on a closed cell: `inner`, the cell inset by its bevel, cut to
 * the share of `cell` nearest the light that the theme's extent covers. A
 * band is cut straight, an arc along a circle that bows toward the far edge,
 * and a spot is a circle against the lit edge. Each corner keeps where it came
 * from, so the renderer rounds the cell's corners and not the cut.
 */
export function glareOutline(
  cell: readonly Point[],
  inner: readonly Point[],
  board: BoardTheme,
): ClippedPoint[] {
  const light = toward(board.lightAngle);
  const side = across(light);
  const [lo, hi] = extent(cell, light);
  const depth = board.glossExtent * (hi - lo);
  const cut = hi - depth;
  const reach = 2 * Math.max(...cell.map((p) => Math.hypot(p.x, p.y)));
  if (board.glossShape === "band") return intersectConvex(inner, halfPlane(light, cut, reach));
  const [near, far] = extent(inner, side);
  const at = (alongLight: number) => ({
    x: light.x * alongLight + side.x * ((near + far) / 2),
    y: light.y * alongLight + side.y * ((near + far) / 2),
  });
  if (board.glossShape === "spot") {
    const [, top] = extent(inner, light);
    return intersectConvex(inner, circle(at(top - depth / 2), depth / 2, CIRCLE_SIDES));
  }
  const half = (far - near) / 2;
  const bow = Math.max(ARC_BOW * depth, 1e-3);
  const radius = (half * half + bow * bow) / (2 * bow);
  return intersectConvex(inner, circle(at(cut + radius), radius, CIRCLE_SIDES));
}
