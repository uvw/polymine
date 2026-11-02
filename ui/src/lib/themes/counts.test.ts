import { describe, expect, it } from "vitest";
import { themeById } from "./catalog";
import { countKey, countSwatch, prefersDarkInk } from "./counts";
import type { BoardTheme } from "./types";

const pride = themeById("pride").board;
const board = (numbers: number[], numberRingFrom: number | null): BoardTheme => ({
  ...pride,
  numbers,
  numberRingFrom,
});

describe("countSwatch", () => {
  it("rings counts from the ring start up", () => {
    const b = board([1, 2, 3], 3);
    expect(countSwatch(b, 2)).toEqual({ color: 2, ring: false });
    expect(countSwatch(b, 3)).toEqual({ color: 3, ring: true });
  });

  it("gives counts past the colors the last one", () => {
    expect(countSwatch(board([1, 2, 3], null), 7)).toEqual({ color: 3, ring: false });
  });
});

describe("countKey", () => {
  it("lists every count the board can show, each with its own look", () => {
    const key = countKey(pride, 14);
    expect(key).toHaveLength(14);
    expect(key.filter((entry) => entry.ring).map((entry) => entry.from)).toEqual([
      9, 10, 11, 12, 13, 14,
    ]);
  });

  it("stops at the board's highest count", () => {
    expect(countKey(pride, 8).map((entry) => entry.to)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("merges counts that look alike into a range", () => {
    const key = countKey(board([1, 2, 3], 6), 8);
    expect(key.map(({ from, to, ring }) => [from, to, ring])).toEqual([
      [1, 1, false],
      [2, 2, false],
      [3, 5, false],
      [6, 8, true],
    ]);
  });

  it("is empty before a board loads", () => {
    expect(countKey(pride, 0)).toEqual([]);
  });
});

describe("prefersDarkInk", () => {
  it("picks the ink that reads on the color", () => {
    expect(prefersDarkInk(0xffd400)).toBe(true);
    expect(prefersDarkInk(0x2f5efa)).toBe(false);
  });
});
