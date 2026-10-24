/**
 * The ferrofluid's win and loss as shapes over time, for its shader to draw.
 * Lengths are in pixels, from the cells' inradius; times are in milliseconds
 * since the game ended.
 */

/**
 * A win: a droplet falls into the middle, punches a crater that rebounds into
 * a jet, throws up a crown of spikes, and sends a slow ring out that floods
 * the cells it crosses and reflects off the board's edges. The film drains a
 * while after the ring has passed.
 */
export const WIN = {
  /** The droplet's fall, and where it starts above the board, in inradii. */
  fallMs: 520,
  dropFrom: 7,
  dropRadius: 1,
  /** The crater's depth and width in inradii; it rebounds once a period. */
  crater: 1.1,
  craterWidth: 1.4,
  craterDecayMs: 420,
  craterPeriodMs: 760,
  /** The crown: its spikes' height, peaking this long after the impact, on a ring that widens. */
  crownHeight: 1.9,
  crownPeakMs: 170,
  crownFrom: 0.9,
  crownGrow: 2,
  crownGrowMs: 300,
  /** The jet that rises from the crater as it rebounds. */
  jetHeight: 2.4,
  jetRadius: 0.45,
  jetStartMs: 230,
  jetMs: 420,
  /** The ring, in inradii per second and inradii; reflections come back at this share. */
  ringSpeed: 8.5,
  ringHeight: 0.6,
  ringDecayMs: 1700,
  wavelength: 1.8,
  reflect: 0.6,
  /** The film drains from the middle out, starting this long after the impact. */
  drainAfterMs: 1900,
  /** The whole splash, from the impact. */
  ms: 3800,
} as const;

/** A loss: three quick, small rings leave the mine and die out fast. */
export const LOSS = {
  rings: 3,
  gapMs: 140,
  speed: 15,
  height: 0.35,
  decayMs: 380,
  wavelength: 0.8,
  ms: 1300,
} as const;

/** What the shader draws at one moment. */
export interface Waves {
  /** Up to four rings from the event's point: each radius, negative for none, and height. */
  rings: [number, number, number, number];
  heights: [number, number, number, number];
  wavelength: number;
  /** How strongly the first ring comes back off the board's edges, from 0 to 1. */
  reflect: number;
  /** The crater's depth, negative where it bulges, and its width. */
  crater: { depth: number; width: number };
  crown: { radius: number; height: number };
  jet: { height: number; radius: number };
  /** The falling droplet's middle above the board, or null once it has landed. */
  drop: { z: number; radius: number } | null;
  /** Cells this near the point are flooded, and this near drained again; negative for none. */
  flood: number;
  drain: number;
  done: boolean;
}

const NONE: [number, number, number, number] = [-1, -1, -1, -1];
const FLAT: [number, number, number, number] = [0, 0, 0, 0];

function calm(): Waves {
  return {
    rings: [...NONE],
    heights: [...FLAT],
    wavelength: 1,
    reflect: 0,
    crater: { depth: 0, width: 1 },
    crown: { radius: 0, height: 0 },
    jet: { height: 0, radius: 1 },
    drop: null,
    flood: -1,
    drain: -1,
    done: false,
  };
}

/** The win `ms` after the game ended, for cells of inradius `r`. */
export function winAt(ms: number, r: number): Waves {
  const w = calm();
  w.wavelength = WIN.wavelength * r;
  if (ms < WIN.fallMs) {
    // It falls from rest, so its height drops with the square of the time.
    const fallen = ms / WIN.fallMs;
    w.drop = {
      z: WIN.dropRadius * r + WIN.dropFrom * r * (1 - fallen * fallen),
      radius: WIN.dropRadius * r,
    };
    return w;
  }
  const t = ms - WIN.fallMs;
  w.crater = {
    depth:
      WIN.crater *
      r *
      Math.exp(-t / WIN.craterDecayMs) *
      Math.cos((2 * Math.PI * t) / WIN.craterPeriodMs),
    width: WIN.craterWidth * r,
  };
  const rise = t / WIN.crownPeakMs;
  w.crown = {
    radius: r * (WIN.crownFrom + WIN.crownGrow * (1 - Math.exp(-t / WIN.crownGrowMs))),
    height: WIN.crownHeight * r * rise * Math.exp(1 - rise),
  };
  const jet = (t - WIN.jetStartMs) / WIN.jetMs;
  if (jet > 0 && jet < 1) {
    w.jet = { height: WIN.jetHeight * r * Math.sin(Math.PI * jet), radius: WIN.jetRadius * r };
  }
  const radius = (WIN.ringSpeed * r * t) / 1000;
  w.rings[0] = radius;
  w.heights[0] = WIN.ringHeight * r * Math.exp(-t / WIN.ringDecayMs);
  w.reflect = WIN.reflect;
  w.flood = radius + w.wavelength;
  w.drain = t > WIN.drainAfterMs ? (WIN.ringSpeed * r * (t - WIN.drainAfterMs)) / 1000 : -1;
  w.done = t > WIN.ms;
  return w;
}

/** The loss `ms` after the game ended, for cells of inradius `r`. */
export function lossAt(ms: number, r: number): Waves {
  const w = calm();
  w.wavelength = LOSS.wavelength * r;
  for (let i = 0; i < LOSS.rings; i++) {
    const t = ms - i * LOSS.gapMs;
    if (t < 0) continue;
    w.rings[i] = (LOSS.speed * r * t) / 1000;
    w.heights[i] = LOSS.height * r * Math.exp(-t / LOSS.decayMs) * (1 - i * 0.25);
  }
  w.done = ms > LOSS.ms;
  return w;
}

/** A ring's profile `d` pixels from its crest: a crest with a trough each side. */
export function wave(d: number, wavelength: number): number {
  return Math.cos((2 * Math.PI * d) / wavelength) * Math.exp(-(d * d) / (wavelength * wavelength));
}

/** Where a point's reflections sit across the four edges of a box. */
export function mirrors(
  p: { x: number; y: number },
  box: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number }[] {
  return [
    { x: 2 * box.minX - p.x, y: p.y },
    { x: 2 * box.maxX - p.x, y: p.y },
    { x: p.x, y: 2 * box.minY - p.y },
    { x: p.x, y: 2 * box.maxY - p.y },
  ];
}
