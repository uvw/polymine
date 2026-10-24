import type { Point } from "../bindings";

export type Direction = "up" | "down" | "left" | "right";

/** Screen angles in radians, with y pointing down. */
const ANGLE: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** Neighbors further than this from the arrow's direction are never picked. */
const MAX_DEVIATION = (80 * Math.PI) / 180;

/**
 * The neighbor of `from` that best matches an arrow key, on any tiling.
 *
 * Neighbors are scored by how far they deviate from the arrow's angle, plus a
 * small penalty for distance, so an edge neighbor beats a corner neighbor at a
 * similar angle. Returns `null` when nothing lies in that direction.
 */
export function neighborToward(
  from: number,
  direction: Direction,
  centers: readonly Point[],
  neighbors: readonly (readonly number[])[],
): number | null {
  const origin = centers[from];
  const candidates = neighbors[from];
  if (!origin || !candidates) return null;
  const target = ANGLE[direction];
  const offsets = candidates.flatMap((n) => {
    const c = centers[n];
    return c ? [{ n, dx: c.x - origin.x, dy: c.y - origin.y }] : [];
  });
  // Distance counts relative to the nearest neighbor, so the scoring works in
  // any unit, board or pixels.
  const nearest = Math.min(...offsets.map((o) => Math.hypot(o.dx, o.dy)));
  let best: number | null = null;
  let bestScore = Infinity;
  for (const { n, dx, dy } of offsets) {
    const delta = Math.atan2(dy, dx) - target;
    const deviation = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
    if (deviation > MAX_DEVIATION) continue;
    const score = deviation + 0.15 * (Math.hypot(dx, dy) / nearest);
    const tie = Math.abs(score - bestScore) <= 1e-9;
    if (score < bestScore - 1e-9 || (tie && best !== null && n < best)) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}
