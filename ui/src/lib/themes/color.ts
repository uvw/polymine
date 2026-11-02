/** Color math for themes: mixing, WCAG contrast, color vision deficiency, and distance. */

/** Three channels: linear light from 0 to 1, or OKLab coordinates. */
export type Rgb = [number, number, number];

const channels = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (c: number) => {
  const v = Math.max(0, Math.min(1, c));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
};

const clip = (v: number) => Math.max(0, Math.min(1, v));
const clipped = ([r, g, b]: Rgb): Rgb => [clip(r), clip(g), clip(b)];

/** `hex` in linear light. */
export const linear = (hex: number): Rgb => {
  const [r, g, b] = channels(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
};

/** A linear-light color as 0xRRGGBB, clipped to the sRGB gamut. */
export const fromLinear = ([r, g, b]: Rgb): number =>
  (toSrgb(r) << 16) | (toSrgb(g) << 8) | toSrgb(b);

/** WCAG relative luminance of a linear-light color. */
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG 2 contrast ratio, from 1 to 21. */
export function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(linear(a)), luminance(linear(b))].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

export type Deficiency = "deuteranopia" | "protanopia" | "tritanopia";

type Matrix = readonly [Rgb, Rgb, Rgb];

/** Machado, Oliveira, and Fernandes (2009) matrices at full severity. */
const SIMULATION: Record<Deficiency, Matrix> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const dot = (u: Rgb, v: Rgb) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const apply = (m: Matrix, v: Rgb): Rgb => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** How a linear-light color looks to someone with `deficiency`, clipped to the sRGB gamut. */
export const simulateLinear = (v: Rgb, deficiency: Deficiency): Rgb =>
  clipped(apply(SIMULATION[deficiency], v));

/** How `hex` looks to someone with the given color vision deficiency. */
export function simulate(hex: number, deficiency: Deficiency): number {
  return fromLinear(simulateLinear(linear(hex), deficiency));
}

/** OKLab coordinates of a linear-light color. */
export function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The linear-light color at OKLab coordinates. It may fall outside the sRGB gamut. */
export function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Perceptual distance in OKLab, times 100. CSS Color 4 treats a deltaE OK of
 * 0.02 as just noticeable, so 2 units here is one just-noticeable step.
 */
export function distance(a: number, b: number): number {
  const [p, q] = [oklab(linear(a)), oklab(linear(b))];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const column = (m: Matrix, j: 0 | 1 | 2): Rgb => [m[0][j], m[1][j], m[2][j]];
const transpose = (m: Matrix): Matrix => [column(m, 0), column(m, 1), column(m, 2)];
const product = (a: Matrix, b: Matrix): Matrix =>
  transpose([apply(a, column(b, 0)), apply(a, column(b, 1)), apply(a, column(b, 2))]);
const scale = (v: Rgb, k: number): Rgb => [v[0] * k, v[1] * k, v[2] * k];
const outer = (u: Rgb, v: Rgb): Matrix => [scale(v, u[0]), scale(v, u[1]), scale(v, u[2])];
const add = (u: Rgb, v: Rgb, k: number): Rgb => [u[0] + k * v[0], u[1] + k * v[1], u[2] + k * v[2]];
const plus = (a: Matrix, b: Matrix, k = 1): Matrix => [
  add(a[0], b[0], k),
  add(a[1], b[1], k),
  add(a[2], b[2], k),
];
const IDENTITY: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const LUMA = scale([0.2126, 0.7152, 0.0722], 1 / Math.hypot(0.2126, 0.7152, 0.0722));

/** The unit eigenvector of a symmetric matrix with the largest eigenvalue, by power iteration. */
function principal(m: Matrix): Rgb {
  let v: Rgb = [0.6, 0.5, 0.4];
  for (let i = 0; i < 100; i++) {
    const next = apply(m, v);
    v = scale(next, 1 / Math.hypot(...next));
  }
  return v;
}

/**
 * Error-shifting daltonization as one matrix on linear light. What the
 * simulation loses lies along one direction, and its amount moves onto the
 * chroma axis the deficiency sees best, at constant luminance. Red-green
 * deficiencies see reds turn bluer and greens yellower; tritanopia sees blues
 * turn redder. Grays lose nothing, so they stay put.
 */
function correctionMatrix(deficiency: Deficiency): Matrix {
  const simulation = SIMULATION[deficiency];
  const loss = plus(IDENTITY, simulation, -1);
  const amount = apply(transpose(loss), principal(product(loss, transpose(loss))));
  const flat = plus(IDENTITY, outer(LUMA, LUMA), -1);
  const seen = principal(product(flat, product(product(transpose(simulation), simulation), flat)));
  const [probe, axis] = deficiency === "tritanopia" ? ([2, 0] as const) : ([0, 2] as const);
  const sign = amount[probe] * seen[axis] < 0 ? -1 : 1;
  return plus(IDENTITY, outer(seen, amount), sign);
}

const CORRECTION: Record<Deficiency, Matrix> = {
  deuteranopia: correctionMatrix("deuteranopia"),
  protanopia: correctionMatrix("protanopia"),
  tritanopia: correctionMatrix("tritanopia"),
};

/** A linear-light color corrected for `deficiency`, clipped to the sRGB gamut. */
export const daltonize = (v: Rgb, deficiency: Deficiency): Rgb =>
  clipped(apply(CORRECTION[deficiency], v));

const LINEAR = Float64Array.from({ length: 256 }, (_, c) => toLinear(c));

/** Corrects unpremultiplied RGBA pixels for `deficiency` in place. Transparent ones stay. */
export function daltonizePixels(data: Uint8ClampedArray, deficiency: Deficiency): void {
  const at = (i: number) => LINEAR[data[i] ?? 0] ?? 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [r, g, b] = daltonize([at(i), at(i + 1), at(i + 2)], deficiency);
    data[i] = toSrgb(r);
    data[i + 1] = toSrgb(g);
    data[i + 2] = toSrgb(b);
  }
}

/** A theme color as CSS, with `null` meaning no fill. */
export function cssColor(color: number | null): string {
  return color === null ? "transparent" : `#${color.toString(16).padStart(6, "0")}`;
}

/** `a` moved toward `b` by `amount`, from 0 (all `a`) to 1 (all `b`). */
export function mix(a: number, b: number, amount: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return (lerp(ar, br) << 16) | (lerp(ag, bg) << 8) | lerp(ab, bb);
}
