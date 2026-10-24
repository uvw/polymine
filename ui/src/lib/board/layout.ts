import type { Bounds } from "../bindings";

export interface Fit {
  /** Pixels per board unit. */
  scale: number;
  /** Screen position of board point (0, 0). */
  offsetX: number;
  offsetY: number;
}

/** Scales the board to fill the viewport, centered, keeping `padding` pixels clear. */
export function fitBoard(bounds: Bounds, width: number, height: number, padding: number): Fit {
  const boardW = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const boardH = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const scale = Math.max(
    1,
    Math.min((width - 2 * padding) / boardW, (height - 2 * padding) / boardH),
  );
  return {
    scale,
    offsetX: (width - boardW * scale) / 2 - bounds.minX * scale,
    offsetY: (height - boardH * scale) / 2 - bounds.minY * scale,
  };
}
