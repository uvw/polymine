/**
 * Color filters for color vision deficiency. A filter moves the board colors
 * a player has to tell apart until every pair meets its bar under the Machado
 * simulation of that deficiency, and in normal vision too. A pair the theme
 * itself keeps below a bar only has to keep what the theme gives it. A board
 * that already passes comes back unchanged.
 */
import {
  contrast,
  distance,
  fromLinear,
  fromOklab,
  linear,
  luminance,
  oklab,
  simulate,
  simulateLinear,
  type Deficiency,
  type Rgb,
} from "./color";
import { PLAIN, backdropLooks, bodyLooks, seenUnder, type Look } from "./gloss";
import type { BoardTheme, Theme } from "./types";

/**
 * Least `distance` between two count colors when digits carry the count. Side
 * by side, about one just-noticeable step is enough.
 */
export const DIGIT_SEPARATION = 2.5;
/**
 * Least `distance` between two count colors when color alone carries it, and
 * between marks a player names on sight: the hint and flag rings, a blast and
 * an open cell, a count's fill and a cell. About five steps, since a player
 * names a color-only count from one small cell against the key.
 */
export const COLOR_SEPARATION = 10;
/** Contrast a digit needs on an open cell. */
export const READABLE = 4.5;
/** Contrast for closed cells on open ones, and for the flag, the mine, and `?` on their cells. */
export const VISIBLE = 3;
/**
 * Contrast closed cells keep on open ones in an editor theme that relaxes it
 * to `pane-contrast`. GitHub Dark's inset canvas on its canvas, at 1.09:1, is
 * the closest pair of panes among the editor themes. The color filter can pull
 * a pair about 0.02 closer.
 */
export const PANE = 1.06;

/**
 * Pairs below a bar move this far past it, which covers rounding to 8-bit
 * colors and some of the simulation's error.
 */
const HEADROOM = { distance: 1.2, contrast: 1.03 };
/** Rounds of corrections before the best result so far is kept. */
const SWEEPS = 400;
/** Largest step one correction takes, in OKLab units times 100. */
const STEP = 6;
/** Cells are the theme's largest areas, so they move a quarter as far as marks and numbers. */
const CELL_WEIGHT = 0.25;
/**
 * A pair the theme keeps below its bar keeps at least this share of its
 * normal-vision value, so a filter doesn't chase changes nobody would see.
 */
const KEEP = 0.95;

const MARKS = [
  "closed",
  "open",
  "exploded",
  "flag",
  "flagOutline",
  "hint",
  "mine",
  "mineSpark",
  "question",
] as const;
type Mark = (typeof MARKS)[number];

/** Colors drawn as shades of a mark's color, which move with it. */
const SHADES: Partial<
  Record<Mark, readonly ("closedHover" | "closedPressed" | "closedEdge" | "openEdge")[]>
> = {
  closed: ["closedHover", "closedPressed", "closedEdge"],
  open: ["openEdge"],
};

type Space = "normal" | "seen";
const SPACES: readonly Space[] = ["normal", "seen"];

interface Rule {
  kind: "distance" | "contrast";
  /** Colors on one side. With several, the best one counts, as a flag shows by fill or outline. */
  a: readonly number[];
  b: number;
  /**
   * What a cell's shade and glare do to each side's color, from `gloss.ts`.
   * The worst pair of looks counts, since a mark can sit anywhere on its cell.
   */
  aLooks: readonly Look[];
  bLooks: readonly Look[];
  space: Space;
  need: number;
}

interface Slot {
  lab: Rgb;
  hex: number;
  seen: number;
  weight: number;
}

const toLab = (hex: number): Rgb => oklab(linear(hex)).map((x) => 100 * x) as Rgb;

/** The nearest color in the sRGB gamut with the same lightness and hue, by lowering chroma. */
function fit([l, a, b]: Rgb): Rgb {
  const lightness = Math.max(0, Math.min(100, l));
  const inside = (k: number) =>
    fromOklab([lightness / 100, (a * k) / 100, (b * k) / 100]).every(
      (c) => c >= -1e-7 && c <= 1 + 1e-7,
    );
  if (inside(1)) return [lightness, a, b];
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return [lightness, a * lo, b * lo];
}

const toLinearLight = (lab: Rgb): Rgb =>
  fromOklab([lab[0] / 100, lab[1] / 100, lab[2] / 100]).map((c) =>
    Math.max(0, Math.min(1, c)),
  ) as Rgb;

const encode = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (v: number) => {
  const c = Math.max(0, Math.min(255, v)) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** A linear-light color under `l`, blended per 8-bit channel as the screen does. */
const under = (light: Rgb, l: Look): Rgb =>
  l === PLAIN ? light : (light.map((c, i) => decode(encode(c) * l.keep + (l.add[i] ?? 0))) as Rgb);

/** Moves a board's colors for one deficiency; see the module comment. */
class Solver {
  /** One per distinct color, so colors a theme repeats, such as a ring's, stay the same. */
  private readonly slots: Slot[] = [];
  /** The slot of each number, then of each mark. */
  private readonly slotOf: number[];
  private readonly rules: Rule[] = [];

  constructor(
    private readonly board: BoardTheme,
    private readonly deficiency: Deficiency,
  ) {
    const count = board.numbers.length;
    // The question mark's outline, when the theme draws one, comes last.
    const outline = board.questionOutline === null ? [] : [board.questionOutline];
    const colors = [...board.numbers, ...MARKS.map((mark) => board[mark]), ...outline];
    this.slotOf = colors.map((hex, i) => {
      const weight = i === count || i === count + 1 ? CELL_WEIGHT : 1;
      const known = this.slots.findIndex((slot) => slot.hex === hex);
      if (known >= 0) {
        const slot = this.slots[known] as Slot;
        slot.weight = Math.min(slot.weight, weight);
        return known;
      }
      this.slots.push({ lab: toLab(hex), hex, seen: simulate(hex, deficiency), weight });
      return this.slots.length - 1;
    });
    const number = (i: number) => this.slotOf[i] as number;
    const mark = (name: Mark) => this.slotOf[count + MARKS.indexOf(name)] as number;
    const relate = (
      kind: Rule["kind"],
      a: number[],
      b: number,
      bar: number,
      aLooks: readonly Look[] = [PLAIN],
      bLooks: readonly Look[] = [PLAIN],
    ) => {
      const looks = { aLooks, bLooks };
      const original = this.measure({ kind, a, b, ...looks, space: "normal", need: 0 });
      const need = original >= bar ? bar : original * KEEP;
      for (const space of SPACES) this.rules.push({ kind, a, b, ...looks, space, need });
    };
    const closed = backdropLooks(board, "closed");
    const digits = board.numberStyle !== "colors";
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        relate("distance", [number(i)], number(j), digits ? DIGIT_SEPARATION : COLOR_SEPARATION);
      }
    }
    for (let i = 0; i < count; i++) {
      if (digits) {
        relate("contrast", [number(i)], mark("open"), READABLE, [PLAIN], bodyLooks(board, "open"));
      } else {
        relate("distance", [number(i)], mark("open"), COLOR_SEPARATION);
        relate("distance", [number(i)], mark("closed"), COLOR_SEPARATION);
      }
    }
    const [closedBody, openBody] = [bodyLooks(board, "closed"), bodyLooks(board, "open")];
    relate("contrast", [mark("closed")], mark("open"), VISIBLE, closedBody, openBody);
    const flag = [mark("flag"), mark("flagOutline")];
    relate("contrast", flag, mark("closed"), VISIBLE, [PLAIN], closed);
    const question = [mark("question"), ...outline.map(() => this.slotOf.at(-1) as number)];
    relate("contrast", question, mark("closed"), VISIBLE, [PLAIN], closed);
    const blast = bodyLooks(board, "exploded");
    relate("contrast", [mark("mine")], mark("exploded"), VISIBLE, [PLAIN], blast);
    relate("contrast", [mark("mineSpark")], mark("open"), VISIBLE, [PLAIN], openBody);
    relate("distance", [mark("hint")], mark("flag"), COLOR_SEPARATION);
    relate("distance", [mark("exploded")], mark("open"), COLOR_SEPARATION);
  }

  solve(): BoardTheme {
    let best = { shortfall: Infinity, hexes: this.hexes() };
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      const failing = this.rules.filter((rule) => this.measure(rule) < rule.need);
      const shortfall = failing.reduce((sum, rule) => sum + 1 - this.measure(rule) / rule.need, 0);
      if (shortfall < best.shortfall) best = { shortfall, hexes: this.hexes() };
      if (failing.length === 0) break;
      for (const rule of failing) this.correct(rule);
    }
    return this.result(best.hexes);
  }

  /** Each number's color, then each mark's. */
  private hexes(): number[] {
    return this.slotOf.map((slot) => (this.slots[slot] as Slot).hex);
  }

  /** The rule's value on the current 8-bit colors, as the theme tests measure it. */
  private measure(rule: Rule): number {
    return this.worstLooks(rule).value;
  }

  /** The pair of looks that gives the rule its least value, and that value. */
  private worstLooks({ kind, a, b, aLooks, bLooks, space }: Rule) {
    const color = (i: number, l: Look) => {
      const slot = this.slots[i] as Slot;
      if (l === PLAIN) return space === "normal" ? slot.hex : slot.seen;
      const hex = seenUnder(slot.hex, l);
      return space === "normal" ? hex : simulate(hex, this.deficiency);
    };
    const measure = kind === "distance" ? distance : contrast;
    let worst = { value: Infinity, aLook: PLAIN, bLook: PLAIN };
    for (const aLook of aLooks) {
      for (const bLook of bLooks) {
        const back = color(b, bLook);
        const value = Math.max(...a.map((i) => measure(color(i, aLook), back)));
        if (value < worst.value) worst = { value, aLook, bLook };
      }
    }
    return worst;
  }

  /** What a viewer sees of `lab` under `l`: its OKLab coordinates times 100 and its luminance. */
  private view(lab: Rgb, space: Space, l: Look = PLAIN): { lab: Rgb; y: number } {
    const light = under(toLinearLight(lab), l);
    const seen = space === "normal" ? light : simulateLinear(light, this.deficiency);
    return { lab: oklab(seen).map((x) => 100 * x) as Rgb, y: luminance(seen) };
  }

  /** How `f` changes as each OKLab coordinate of `lab` grows, by forward differences. */
  private slopes<T>(lab: Rgb, f: (lab: Rgb) => T, change: (from: T, to: T) => number): Rgb {
    const h = 0.01;
    const base = f(lab);
    const along = (k: 0 | 1 | 2) => {
      const moved: Rgb = [...lab];
      moved[k] += h;
      return change(base, f(moved)) / h;
    };
    return [along(0), along(1), along(2)];
  }

  /**
   * One position-based correction: moves the rule's colors by the least
   * weighted step that meets it, to first order.
   */
  private correct(rule: Rule): void {
    const target = rule.need * HEADROOM[rule.kind];
    const { aLook, bLook } = this.worstLooks(rule);
    const pair = { ...rule, aLooks: [aLook], bLooks: [bLook] };
    const value = (i: number) => this.measure({ ...pair, a: [i] });
    const a = rule.a.reduce((best, i) => (value(i) > value(best) ? i : best));
    const [p, q] = [this.slots[a] as Slot, this.slots[rule.b] as Slot];
    const seenP = (lab: Rgb) => this.view(lab, rule.space, aLook);
    const seenQ = (lab: Rgb) => this.view(lab, rule.space, bLook);
    let gradients: [Rgb, Rgb];
    let gap: number;
    if (rule.kind === "distance") {
      const [vp, vq] = [seenP(p.lab).lab, seenQ(q.lab).lab];
      const d = Math.hypot(vp[0] - vq[0], vp[1] - vq[1], vp[2] - vq[2]);
      // Colors that look the same separate in lightness, the first one lighter.
      const g: Rgb =
        d > 1e-6 ? [(vp[0] - vq[0]) / d, (vp[1] - vq[1]) / d, (vp[2] - vq[2]) / d] : [1, 0, 0];
      const along = (from: { lab: Rgb }, to: { lab: Rgb }) =>
        (to.lab[0] - from.lab[0]) * g[0] +
        (to.lab[1] - from.lab[1]) * g[1] +
        (to.lab[2] - from.lab[2]) * g[2];
      const toward = this.slopes(q.lab, seenQ, along);
      gradients = [this.slopes(p.lab, seenP, along), [-toward[0], -toward[1], -toward[2]]];
      gap = target - d;
    } else {
      // Contrast in logs is the brighter color's log luminance minus the darker one's.
      const [yp, yq] = [seenP(p.lab).y, seenQ(q.lab).y];
      const lit = (hex: number, l: Look) => luminance(linear(seenUnder(hex, l)));
      const brighter = yp > yq || (yp === yq && lit(p.hex, aLook) >= lit(q.hex, bLook));
      const log = (from: { y: number }, to: { y: number }) =>
        Math.log((to.y + 0.05) / (from.y + 0.05));
      const [lp, lq] = [this.slopes(p.lab, seenP, log), this.slopes(q.lab, seenQ, log)];
      const sign = brighter ? 1 : -1;
      gradients = [
        [sign * lp[0], sign * lp[1], sign * lp[2]],
        [-sign * lq[0], -sign * lq[1], -sign * lq[2]],
      ];
      gap = Math.log(target) - Math.abs(Math.log((yp + 0.05) / (yq + 0.05)));
    }
    const [gp, gq] = gradients;
    const norm2 = (v: Rgb) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const denominator = p.weight * norm2(gp) + q.weight * norm2(gq);
    if (gap <= 0 || denominator < 1e-12) return;
    const lambda = gap / denominator;
    this.move(p, gp, lambda * p.weight);
    this.move(q, gq, lambda * q.weight);
  }

  private move(slot: Slot, gradient: Rgb, amount: number): void {
    const length = Math.hypot(...gradient) * amount;
    const k = length > STEP ? (amount * STEP) / length : amount;
    slot.lab = fit([
      slot.lab[0] + gradient[0] * k,
      slot.lab[1] + gradient[1] * k,
      slot.lab[2] + gradient[2] * k,
    ]);
    slot.hex = fromLinear(toLinearLight(slot.lab));
    slot.seen = simulate(slot.hex, this.deficiency);
  }

  /** The board with `hexes` in place, shades moved with their marks, and the filter recorded. */
  private result(hexes: readonly number[]): BoardTheme {
    const count = this.board.numbers.length;
    const out: BoardTheme = {
      ...this.board,
      numbers: hexes.slice(0, count),
      questionOutline:
        this.board.questionOutline === null ? null : (hexes[count + MARKS.length] as number),
      filter: this.deficiency,
    };
    MARKS.forEach((mark, i) => {
      const hex = hexes[count + i] as number;
      if (hex === this.board[mark]) return;
      out[mark] = hex;
      const [before, after] = [toLab(this.board[mark]), toLab(hex)];
      for (const shade of SHADES[mark] ?? []) {
        const lab = toLab(this.board[shade]);
        const moved = fit([
          lab[0] + after[0] - before[0],
          lab[1] + after[1] - before[1],
          lab[2] + after[2] - before[2],
        ]);
        out[shade] = fromLinear(toLinearLight(moved));
      }
    });
    return out;
  }
}

/** `board` with its colors moved so a player with `deficiency` can tell them apart. */
export function filterBoard(board: BoardTheme, deficiency: Deficiency): BoardTheme {
  return new Solver(board, deficiency).solve();
}

const filtered = new WeakMap<Theme, Map<Deficiency, Theme>>();

/**
 * `theme` with its board filtered, or as it is for `off`. Results are kept
 * per resolved theme, so per accent and mode too, and per filter.
 */
export function filterTheme(theme: Theme, filter: Deficiency | "off" | null | undefined): Theme {
  if (!filter || filter === "off") return theme;
  let byFilter = filtered.get(theme);
  if (!byFilter) filtered.set(theme, (byFilter = new Map()));
  let result = byFilter.get(filter);
  if (!result) {
    result = { ...theme, board: filterBoard(theme.board, filter) };
    byFilter.set(filter, result);
  }
  return result;
}
