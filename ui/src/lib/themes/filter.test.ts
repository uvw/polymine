import { describe, expect, it } from "vitest";
import { EXPERIMENTAL_THEMES } from "./builtin";
import { BUILT_IN_THEMES, themeById } from "./catalog";
import { contrast, cssColor, distance, simulate, type Deficiency } from "./color";
import {
  COLOR_SEPARATION,
  DIGIT_SEPARATION,
  PANE,
  READABLE,
  VISIBLE,
  filterBoard,
  filterTheme,
} from "./filter";
import { backdrops, bodies, type Backdrop } from "./gloss";
import { resolveTheme, staticColors, type ThemeEnv } from "./resolve";
import type { BoardTheme, Theme } from "./types";

const DEFICIENCIES: Deficiency[] = ["deuteranopia", "protanopia", "tritanopia"];

/** Strong accents across the hues, since some themes paint whole cells in the accent. */
const ACCENTS = [0xff2d55, 0x107c10, 0xffb900, 0x0078d4, 0x881798];

/** Light and dark, untinted and tinted with each accent. */
const ENVS: ThemeEnv[] = [false, true].flatMap((dark) => [
  { accent: null, dark },
  ...ACCENTS.map((accent) => ({ accent, dark })),
]);

/** A pair the theme keeps below its bar must keep this share of what it has in normal vision. */
const KEEP = 0.95;
/** The most any color of a built-in theme may move, in `distance` units. */
const MOST_SHIFT = 15;

type View = (color: number) => number;
const NORMAL: View = (color) => color;
const seenWith =
  (deficiency: Deficiency): View =>
  (color) =>
    simulate(color, deficiency);

interface Relation {
  name: string;
  bar: number;
  value(board: BoardTheme, view: View): number;
}

/** Every pair of colors a player has to tell apart, and the bar each must meet. */
function relations(board: BoardTheme): Relation[] {
  const digits = board.numberStyle !== "colors";
  const out: Relation[] = [];
  const apart = (name: string, bar: number, pick: (b: BoardTheme) => [number, number]) =>
    out.push({
      name,
      bar,
      value: (b, view) => distance(...(pick(b).map(view) as [number, number])),
    });
  /** Marks on every color their cell can put under them, the best mark on the worst one. */
  const against = (name: string, bar: number, pick: (b: BoardTheme) => [number[], Backdrop]) =>
    out.push({
      name,
      bar,
      value: (b, view) => {
        const [colors, kind] = pick(b);
        const best = (back: number) =>
          Math.max(...colors.map((c) => contrast(view(c), view(back))));
        return Math.min(...backdrops(b, kind).map(best));
      },
    });
  const n = (b: BoardTheme, i: number) => b.numbers[i] ?? 0;
  board.numbers.forEach((_, i) => {
    for (let j = i + 1; j < board.numbers.length; j++) {
      const bar = digits ? DIGIT_SEPARATION : COLOR_SEPARATION;
      apart(`numbers ${i + 1} and ${j + 1}`, bar, (b) => [n(b, i), n(b, j)]);
    }
    if (digits) against(`number ${i + 1} on an open cell`, READABLE, (b) => [[n(b, i)], "open"]);
    else {
      apart(`count ${i + 1} and an open cell`, COLOR_SEPARATION, (b) => [n(b, i), b.open]);
      apart(`count ${i + 1} and a closed cell`, COLOR_SEPARATION, (b) => [n(b, i), b.closed]);
    }
  });
  out.push({
    name: "closed and open cells",
    bar: VISIBLE,
    value: (b, view) =>
      Math.min(
        ...bodies(b, "closed").flatMap((tile) =>
          bodies(b, "open").map((floor) => contrast(view(tile), view(floor))),
        ),
      ),
  });
  against("the flag on a closed cell", VISIBLE, (b) => [[b.flag, b.flagOutline], "closed"]);
  against("? on a closed cell", VISIBLE, (b) => [
    [b.question, ...(b.questionOutline === null ? [] : [b.questionOutline])],
    "closed",
  ]);
  against("the mine on its blast", VISIBLE, (b) => [[b.mine], "exploded"]);
  against("the mine's spark on an open cell", VISIBLE, (b) => [[b.mineSpark], "open"]);
  apart("the hint and flag rings", COLOR_SEPARATION, (b) => [b.hint, b.flag]);
  apart("a blast and an open cell", COLOR_SEPARATION, (b) => [b.exploded, b.open]);
  return out;
}

/**
 * Relations `filtered` breaks for `view`: each must reach its bar, or keep
 * what `original` has in normal vision when that is lower.
 */
function shortfalls(original: BoardTheme, filtered: BoardTheme, view: View): string[] {
  return relations(original).flatMap(({ name, bar, value }) => {
    const before = value(original, NORMAL);
    const need = before >= bar ? bar : before * KEEP;
    const after = value(filtered, view);
    return after >= need ? [] : [`${name}: ${after.toFixed(2)} < ${need.toFixed(2)}`];
  });
}

/**
 * Whether `board` meets every bar in normal vision. Then the filter's goals
 * are the bars themselves, so filtering its own result changes nothing.
 */
const meetsBars = (board: BoardTheme) =>
  relations(board).every(({ bar, value }) => value(board, NORMAL) >= bar);

const COLOR_FIELDS = [
  "closed",
  "closedHover",
  "closedPressed",
  "closedEdge",
  "open",
  "openEdge",
  "exploded",
  "flag",
  "flagOutline",
  "hint",
  "mine",
  "mineSpark",
  "question",
] as const;

const colorsOf = (b: BoardTheme) => [...b.numbers, ...COLOR_FIELDS.map((field) => b[field])];

/** How far the filter moved the color that moved most. */
const shift = (a: BoardTheme, b: BoardTheme) =>
  Math.max(...colorsOf(a).map((color, i) => distance(color, colorsOf(b)[i] ?? color)));

/** Experiments skip the readability checks until one ships in a bundled theme. */
const CHECKED = BUILT_IN_THEMES.filter((entry) => !EXPERIMENTAL_THEMES.includes(entry.id));

const resolved: [string, Theme][] = CHECKED.flatMap((entry) =>
  ENVS.map((env): [string, Theme] => {
    const accent = env.accent === null ? "" : `, accent ${cssColor(env.accent)}`;
    const theme = resolveTheme(entry, env, staticColors, () => {});
    return [`${entry.id} (${env.dark ? "dark" : "light"}${accent})`, theme];
  }),
);

describe.each(resolved)("%s, filtered", (_, theme) => {
  const original = theme.board;
  const digits = original.numberStyle !== "colors";

  describe.each(DEFICIENCIES)("for %s", (deficiency) => {
    const filtered = filterBoard(original, deficiency);
    const seen = seenWith(deficiency);

    it("keeps distinct number colors apart under the simulation", () => {
      const bar = digits ? DIGIT_SEPARATION : COLOR_SEPARATION;
      original.numbers.forEach((a, i) => {
        original.numbers.forEach((b, j) => {
          if (j <= i || a === b) return;
          const after = distance(seen(filtered.numbers[i] ?? 0), seen(filtered.numbers[j] ?? 0));
          expect(after, `${i + 1} vs ${j + 1}`).toBeGreaterThanOrEqual(bar);
        });
      });
    });

    it.each([
      ["normal vision", NORMAL],
      ["the simulation", seen],
    ] as const)("keeps the theme tests' contrast minimums in %s", (_, view) => {
      const cells = theme.relaxed.has("pane-contrast")
        ? PANE
        : theme.relaxed.has("cell-contrast")
          ? 1.4
          : 3;
      for (const tile of bodies(filtered, "closed")) {
        for (const floor of bodies(filtered, "open")) {
          expect(contrast(view(tile), view(floor))).toBeGreaterThanOrEqual(cells);
        }
      }
      for (const tile of backdrops(filtered, "closed")) {
        const flag = Math.max(
          contrast(view(filtered.flag), view(tile)),
          contrast(view(filtered.flagOutline), view(tile)),
        );
        expect(flag).toBeGreaterThanOrEqual(3);
      }
      if (!digits) return;
      for (const floor of backdrops(filtered, "open")) {
        filtered.numbers.forEach((color, i) => {
          expect(contrast(view(color), view(floor)), `number ${i + 1}`).toBeGreaterThanOrEqual(
            READABLE,
          );
        });
      }
    });

    it("keeps every relation in normal vision and under the simulation", () => {
      expect(shortfalls(original, filtered, NORMAL)).toEqual([]);
      expect(shortfalls(original, filtered, seen)).toEqual([]);
    });

    it("changes nothing that already passes, and little otherwise", () => {
      if (shortfalls(original, original, seen).length === 0) {
        expect(colorsOf(filtered)).toEqual(colorsOf(original));
      }
      expect(shift(original, filtered)).toBeLessThanOrEqual(MOST_SHIFT);
      if (meetsBars(original)) {
        expect(colorsOf(filterBoard(filtered, deficiency))).toEqual(colorsOf(filtered));
      }
    });

    it("keeps colors the theme repeats the same, and records the filter", () => {
      original.numbers.forEach((a, i) => {
        const twin = original.numbers.findIndex((b) => b === a);
        expect(filtered.numbers[i]).toBe(filtered.numbers[twin]);
      });
      expect(filtered.filter).toBe(deficiency);
      expect(filtered.glyphs).toBe(original.glyphs);
    });
  });
});

/** Mulberry32, so a failing palette reproduces from its seed. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

/**
 * A random color for which `fits` holds. Given colors to stay near, each try
 * lands within 96 levels per channel of the next one in turn.
 */
function tryPick(random: Random, fits: (color: number) => boolean, near: number[] = []) {
  for (let i = 0; i < 20000; i++) {
    const center = near[i % Math.max(1, near.length)];
    const channel = (shift: number) =>
      center === undefined
        ? Math.floor(random() * 256)
        : Math.max(0, Math.min(255, ((center >> shift) & 255) + Math.floor(random() * 193) - 96));
    const color = (channel(16) << 16) | (channel(8) << 8) | channel(0);
    if (fits(color)) return color;
  }
  return undefined;
}

function pick(random: Random, fits: (color: number) => boolean = () => true): number {
  const color = tryPick(random, fits);
  if (color === undefined) throw new Error("no color fits");
  return color;
}

const BASE = themeById("graphite").board;

/**
 * A board that passes every bar in normal vision, with a light or a dark
 * floor. With `confusable`, every number after the first looks almost like an
 * earlier one under that deficiency, the worst case for a filter.
 */
function validBoard(
  random: Random,
  style: BoardTheme["numberStyle"],
  confusable?: Deficiency,
): BoardTheme {
  const dark = random() < 0.5;
  const open = pick(random, (c) => (dark ? contrast(c, 0) < 1.5 : contrast(c, 0) > 16));
  const closed = pick(random, (c) => contrast(c, open) >= 3 && distance(c, open) >= 10);
  const numbers: number[] = [];
  const digits = style === "digits";
  const count = digits ? 12 : 8;
  const looksLike = (a: number, b: number, within: number) =>
    !confusable || distance(simulate(a, confusable), simulate(b, confusable)) < within;
  while (numbers.length < count) {
    const fits = (c: number) =>
      (digits
        ? contrast(c, open) >= READABLE
        : distance(c, open) >= 10 && distance(c, closed) >= 10) &&
      numbers.every((p) => distance(c, p) >= (digits ? DIGIT_SEPARATION : COLOR_SEPARATION));
    const like = (c: number) => numbers.some((p) => looksLike(c, p, digits ? 2 : 6));
    // Some colors have no twin that fits; the number then takes any color that does.
    const twin =
      confusable && numbers.length > 0
        ? tryPick(random, (c) => fits(c) && like(c), numbers)
        : undefined;
    numbers.push(twin ?? pick(random, fits));
  }
  const flag = pick(random, (c) => contrast(c, closed) >= 3);
  const exploded = pick(random, (c) => distance(c, open) >= 10);
  return {
    ...BASE,
    numberStyle: style,
    open,
    closed,
    numbers,
    flag,
    flagOutline: pick(random),
    question: pick(random, (c) => contrast(c, closed) >= 3),
    exploded,
    mine: pick(random, (c) => contrast(c, exploded) >= 3),
    mineSpark: pick(random, (c) => contrast(c, open) >= 3),
    hint:
      (confusable &&
        tryPick(random, (c) => distance(c, flag) >= 10 && looksLike(c, flag, 6), [flag])) ||
      pick(random, (c) => distance(c, flag) >= 10),
  };
}

/** A board of colors drawn at random, which may break bars even in normal vision. */
function randomBoard(random: Random): BoardTheme {
  const board: BoardTheme = { ...BASE, numbers: Array.from({ length: 12 }, () => pick(random)) };
  for (const field of COLOR_FIELDS) board[field] = pick(random);
  return board;
}

describe("filtering random palettes", () => {
  const cases: [string, Deficiency, BoardTheme][] = [];
  for (let seed = 1; seed <= 12; seed++) {
    for (const deficiency of DEFICIENCIES) {
      const random = generator(seed * 31 + DEFICIENCIES.indexOf(deficiency));
      cases.push(
        [`digits #${seed}`, deficiency, validBoard(random, "digits")],
        [`colors #${seed}`, deficiency, validBoard(random, "colors")],
        [`confusable digits #${seed}`, deficiency, validBoard(random, "digits", deficiency)],
        [`confusable colors #${seed}`, deficiency, validBoard(random, "colors", deficiency)],
        [`random #${seed}`, deficiency, randomBoard(random)],
      );
    }
  }

  it.each(cases)("%s for %s keeps every relation", (_, deficiency, board) => {
    const filtered = filterBoard(board, deficiency);
    expect(shortfalls(board, filtered, NORMAL)).toEqual([]);
    expect(shortfalls(board, filtered, seenWith(deficiency))).toEqual([]);
    expect(colorsOf(filterBoard(board, deficiency))).toEqual(colorsOf(filtered));
    if (meetsBars(board)) {
      expect(colorsOf(filterBoard(filtered, deficiency))).toEqual(colorsOf(filtered));
    }
  });
});

describe("filterTheme", () => {
  const theme = themeById("midnight");

  it("leaves the theme alone when off", () => {
    expect(filterTheme(theme, "off")).toBe(theme);
    expect(filterTheme(theme, null)).toBe(theme);
    expect(filterTheme(theme, undefined)).toBe(theme);
  });

  it("filters each theme once per filter", () => {
    const deuteranopia = filterTheme(theme, "deuteranopia");
    expect(deuteranopia).toBe(filterTheme(theme, "deuteranopia"));
    expect(deuteranopia).not.toBe(filterTheme(theme, "tritanopia"));
    expect(deuteranopia.board.numbers).not.toEqual(theme.board.numbers);
    expect({ ...deuteranopia, board: theme.board }).toEqual(theme);
  });
});
