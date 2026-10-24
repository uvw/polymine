import type { Point } from "../bindings";

/** Each edge of a closed polygon as a pair of corners. */
function edges(points: readonly Point[]): [Point, Point][] {
  return points.map((a, i) => [a, points[(i + 1) % points.length] as Point]);
}

export function centroid(points: readonly Point[]): Point {
  let cx = 0;
  let cy = 0;
  let twiceArea = 0;
  for (const [a, b] of edges(points)) {
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

/** Distance from `p` to the closest edge of the polygon. */
export function distanceToEdges(points: readonly Point[], p: Point): number {
  let best = Infinity;
  for (const [a, b] of edges(points)) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * Moves every edge of a convex polygon inward by `distance` and returns the new
 * corners. Works for either winding order; a negative distance grows the polygon.
 */
export function insetConvex(points: readonly Point[], distance: number): Point[] {
  const sign = signedArea(points) > 0 ? 1 : -1;
  const shifted = edges(points).map(([a, b]) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * sign * distance;
    const ny = ((b.x - a.x) / len) * sign * distance;
    return [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
    ] as const;
  });
  // Each new corner is where the previous shifted edge meets this one.
  return shifted.map((edge, i) => {
    const prev = shifted[(i - 1 + shifted.length) % shifted.length] ?? edge;
    return intersect(prev[0], prev[1], edge[0], edge[1]) ?? edge[0];
  });
}

function signedArea(points: readonly Point[]): number {
  return edges(points).reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0) / 2;
}

function intersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/** The unit vector toward a light at `degrees` clockwise from the top, with y pointing down. */
export const toward = (degrees: number): Point => {
  const a = (degrees * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
};

/** `v` turned a quarter clockwise on screen. */
export const across = (v: Point): Point => ({ x: -v.y, y: v.x });

const dot = (p: Point, v: Point) => p.x * v.x + p.y * v.y;

/** The least and the greatest `dot(p, axis)` over the points. */
export function extent(points: readonly Point[], axis: Point): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const s = dot(p, axis);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}

/** A corner of a clipped polygon, and where it came from. */
export type ClippedPoint = Point & { from: "subject" | "clip" | "edge" };

/** A square that covers the half plane `dot(p, axis) >= offset` within `reach` of the origin. */
export function halfPlane(axis: Point, offset: number, reach: number): Point[] {
  const side = across(axis);
  const near = { x: axis.x * offset, y: axis.y * offset };
  const far = { x: axis.x * (offset + 2 * reach), y: axis.y * (offset + 2 * reach) };
  const at = (base: Point, k: number) => ({ x: base.x + side.x * k, y: base.y + side.y * k });
  return [at(near, -reach), at(near, reach), at(far, reach), at(far, -reach)];
}

/** A circle as a polygon of `sides` corners. */
export function circle(center: Point, radius: number, sides = 64): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}

function contains(points: readonly Point[], p: Point): boolean {
  const sign = signedArea(points) > 0 ? 1 : -1;
  return edges(points).every(
    ([a, b]) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-9,
  );
}

function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * r.x, y: a.y + t * r.y } : null;
}

/**
 * The overlap of two convex polygons, corners in order around it, each
 * tagged with where it came from: a corner of `subject`, a corner of `clip`,
 * or a crossing of their edges. Empty when they don't overlap.
 */
export function intersectConvex(subject: readonly Point[], clip: readonly Point[]): ClippedPoint[] {
  const found: ClippedPoint[] = [
    ...subject.filter((p) => contains(clip, p)).map((p) => ({ ...p, from: "subject" as const })),
    ...clip.filter((p) => contains(subject, p)).map((p) => ({ ...p, from: "clip" as const })),
  ];
  for (const [a, b] of edges(subject)) {
    for (const [c, d] of edges(clip)) {
      const p = crossing(a, b, c, d);
      if (p) found.push({ ...p, from: "edge" });
    }
  }
  const points: ClippedPoint[] = [];
  for (const p of found) {
    if (!points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)) points.push(p);
  }
  if (points.length < 3) return [];
  const mid = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
  return points.sort(
    (p, q) => Math.atan2(p.y - mid.y, p.x - mid.x) - Math.atan2(q.y - mid.y, q.x - mid.x),
  );
}
