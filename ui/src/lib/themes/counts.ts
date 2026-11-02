/** How a color-only theme shows each count, on the board and in its key. */
import { contrast } from "./color";
import type { BoardTheme } from "./types";

/** Fill for a count with no color; every theme has at least one, so this never shows. */
const MISSING_COUNT_COLOR = 0xffffff;

/** A count's look in a `colors` theme. */
export interface CountSwatch {
  color: number;
  /** Drawn as a band inside the cell's edge, with the middle left open. */
  ring: boolean;
}

/** The look of `count`. Past the end of the theme's colors, the last one stands in. */
export function countSwatch(board: BoardTheme, count: number): CountSwatch {
  const { numbers, numberRingFrom } = board;
  return {
    color: numbers[Math.min(count, numbers.length) - 1] ?? MISSING_COUNT_COLOR,
    ring: numberRingFrom !== null && count >= numberRingFrom,
  };
}

/** One entry in the key: a look, and the counts from `from` to `to` that take it. */
export interface CountKeyEntry extends CountSwatch {
  from: number;
  to: number;
}

/** The looks of counts 1 to `max`, in order, with neighbors that look alike merged. */
export function countKey(board: BoardTheme, max: number): CountKeyEntry[] {
  const key: CountKeyEntry[] = [];
  for (let n = 1; n <= max; n++) {
    const swatch = countSwatch(board, n);
    const last = key.at(-1);
    if (last && last.color === swatch.color && last.ring === swatch.ring) last.to = n;
    else key.push({ ...swatch, from: n, to: n });
  }
  return key;
}

/** Whether black reads better than white on `color`. */
export function prefersDarkInk(color: number): boolean {
  return contrast(color, 0x000000) > contrast(color, 0xffffff);
}
