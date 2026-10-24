import { describe, expect, it } from "vitest";
import { centroid, distanceToEdges, insetConvex } from "./geometry";
import { fitBoard } from "./layout";

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe("geometry", () => {
  it("finds the centroid and the inradius of a square", () => {
    expect(centroid(square)).toEqual({ x: 1, y: 1 });
    expect(distanceToEdges(square, { x: 1, y: 1 })).toBeCloseTo(1);
  });

  it("insets a convex polygon in either winding", () => {
    for (const poly of [square, [...square].reverse()]) {
      const inset = insetConvex(poly, 0.5);
      const xs = inset.map((p) => p.x).sort();
      expect(xs[0]).toBeCloseTo(0.5);
      expect(xs[3]).toBeCloseTo(1.5);
    }
  });
});

describe("fitBoard", () => {
  it("centers a wide board in a tall viewport", () => {
    const fit = fitBoard({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 120, 300, 10);
    expect(fit.scale).toBe(10);
    expect(fit.offsetX).toBe(10);
    expect(fit.offsetY).toBe(125);
  });

  it("accounts for boards that start at a negative coordinate", () => {
    const fit = fitBoard({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, 100, 100, 0);
    expect(fit.offsetX + -1 * fit.scale).toBe(0);
  });
});
