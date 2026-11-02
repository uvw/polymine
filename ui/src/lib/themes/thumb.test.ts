import { describe, expect, it } from "vitest";
import { themeEntry } from "./entry";
import { resolveTheme, staticColors } from "./resolve";
import { thumbEdge } from "./thumb";

const HEADER = "/*\n * Name: T\n * Author: A\n * Description: D\n * Version: 1\n * Format: 1\n */";
const board = (body: string) =>
  resolveTheme(
    themeEntry("t", `${HEADER}\n:root { ${body} }`, false),
    { accent: null, dark: true },
    staticColors,
  ).board;

describe("thumbEdge", () => {
  it("keeps the plate when it stands out from the closed cells", () => {
    expect(thumbEdge(board("--board-plate: #000000; --cell-closed: #808080;"))).toBe(0x000000);
  });

  it("takes the first count when the plate blends in", () => {
    const body = "--board-plate: #202020; --cell-closed: #222222; --number-1: #ffcc00;";
    expect(thumbEdge(board(body))).toBe(0xffcc00);
  });

  it("takes the focus color when the first count blends in too", () => {
    const body =
      "--board-plate: #202020; --cell-closed: #222222; --number-1: #242424; --focus: #ffffff;";
    expect(thumbEdge(board(body))).toBe(0xffffff);
  });

  it("takes the one that stands out most when none reach the bar", () => {
    const body =
      "--board-plate: #777777; --cell-closed: #808080; --number-1: #8a8a8a; --focus: #9a9a9a;";
    expect(thumbEdge(board(body))).toBe(0x9a9a9a);
  });
});
