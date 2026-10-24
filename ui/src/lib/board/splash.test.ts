import { describe, expect, it } from "vitest";
import { LOSS, WIN, lossAt, mirrors, wave, winAt } from "./splash";

describe("winAt", () => {
  it("drops the droplet from rest until it lands", () => {
    const start = winAt(0, 10).drop;
    const halfway = winAt(WIN.fallMs / 2, 10).drop;
    expect(start?.z).toBeCloseTo((WIN.dropFrom + WIN.dropRadius) * 10);
    // A quarter of the fall is done at half the time.
    expect(halfway?.z).toBeCloseTo((WIN.dropRadius + WIN.dropFrom * 0.75) * 10);
    expect(winAt(WIN.fallMs + 1, 10).drop).toBeNull();
  });

  it("raises nothing else while the droplet falls", () => {
    const w = winAt(100, 10);
    expect(w.rings[0]).toBe(-1);
    expect(w.crown.height).toBe(0);
    expect(w.flood).toBe(-1);
  });

  it("peaks the crown soon after the impact, then lets it fall", () => {
    const peak = winAt(WIN.fallMs + WIN.crownPeakMs, 10).crown.height;
    expect(peak).toBeCloseTo(WIN.crownHeight * 10);
    expect(winAt(WIN.fallMs + 1000, 10).crown.height).toBeLessThan(peak / 5);
  });

  it("dips a crater that rebounds into a bulge and a jet", () => {
    expect(winAt(WIN.fallMs, 10).crater.depth).toBeCloseTo(WIN.crater * 10);
    expect(winAt(WIN.fallMs + WIN.craterPeriodMs / 2, 10).crater.depth).toBeLessThan(0);
    expect(winAt(WIN.fallMs + WIN.jetStartMs + WIN.jetMs / 2, 10).jet.height).toBeCloseTo(
      WIN.jetHeight * 10,
    );
  });

  it("widens the ring, floods behind it, and drains from the middle later", () => {
    const early = winAt(WIN.fallMs + 1000, 10);
    expect(early.rings[0]).toBeCloseTo(WIN.ringSpeed * 10);
    expect(early.flood).toBeGreaterThan(early.rings[0]);
    expect(early.drain).toBe(-1);
    expect(early.reflect).toBe(WIN.reflect);
    expect(winAt(WIN.fallMs + WIN.drainAfterMs + 1000, 10).drain).toBeCloseTo(WIN.ringSpeed * 10);
    expect(winAt(WIN.fallMs + WIN.ms + 1, 10).done).toBe(true);
  });
});

describe("lossAt", () => {
  it("starts its rings one after another, each smaller and dying out", () => {
    const w = lossAt(LOSS.gapMs * 1.5, 10);
    expect(w.rings[0]).toBeGreaterThan(w.rings[1]);
    expect(w.rings[2]).toBe(-1);
    // Each ring starts lower than the one before it did.
    expect(lossAt(LOSS.gapMs, 10).heights[1]).toBeLessThan(lossAt(0, 10).heights[0]);
    expect(lossAt(1000, 10).heights[0]).toBeLessThan(LOSS.height);
    expect(w.reflect).toBe(0);
    expect(lossAt(LOSS.ms + 1, 10).done).toBe(true);
  });
});

describe("wave", () => {
  it("crests at its middle and troughs half a wavelength out", () => {
    expect(wave(0, 10)).toBe(1);
    expect(wave(5, 10)).toBeLessThan(0);
    expect(Math.abs(wave(40, 10))).toBeLessThan(1e-6);
  });
});

describe("mirrors", () => {
  it("reflects a point across each edge of a box", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(mirrors({ x: 30, y: 10 }, box)).toEqual([
      { x: -30, y: 10 },
      { x: 170, y: 10 },
      { x: 30, y: -10 },
      { x: 30, y: 90 },
    ]);
  });
});
