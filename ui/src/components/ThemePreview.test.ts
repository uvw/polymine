import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { themeById } from "../lib/themes/catalog";
import { cssColor } from "../lib/themes/color";
import type { BoardTheme } from "../lib/themes/types";
import ThemePreview from "./ThemePreview.svelte";

const draw = (board: BoardTheme) => render(ThemePreview, { props: { board } }).container;
const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-cell]")];
const kinds = (root: HTMLElement) => cells(root).map((cell) => cell.dataset.cell);

describe("ThemePreview", () => {
  it("draws three staggered rows of five cells, hidden from assistive tech", () => {
    const root = draw(themeById("graphite").board);
    expect(root.querySelectorAll("[data-row]")).toHaveLength(3);
    expect(kinds(root)).toEqual([
      "closed", "1", "2", "1", "closed",
      "flag", "3", "mine", "2", "closed",
      "0", "1", "2", "closed", "closed",
    ]); // prettier-ignore
    expect(root.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("draws counts as the theme's glyphs when it has them", () => {
    const board = themeById("datum").board;
    const root = draw(board);
    const one = cells(root)[1]?.querySelector("img");
    expect(one).toHaveAttribute("src", board.glyphs["1"]?.src);
    expect(cells(root)[5]?.querySelector("img")).toHaveAttribute("src", board.glyphs.flag?.src);
    expect(cells(root)[7]?.querySelector("img")).toHaveAttribute("src", board.glyphs.mine?.src);
  });

  it("draws digits in the theme's font and colors without glyphs", () => {
    const board = themeById("graphite").board;
    const two = cells(draw(board))[2];
    expect(two?.textContent).toBe("2");
    expect(two?.style.color).toBe(hexToRgb(cssColor(board.numbers[1] ?? 0)));
    expect(two?.style.fontFamily).toContain(board.fontFamily.split(",")[0]?.replaceAll('"', ""));
  });

  it("draws the flag as a mark and the mine as a dot without glyphs", () => {
    const root = draw(themeById("graphite").board);
    expect(cells(root)[5]?.textContent).toBe("⚑");
    expect(cells(root)[7]?.querySelector("[data-mine]")).not.toBeNull();
  });

  it("fills counted cells with their color in a color-count theme", () => {
    const board = themeById("pride").board;
    const one = cells(draw(board))[1];
    expect(one?.style.background).toContain(hexToRgb(cssColor(board.numbers[0] ?? 0)));
    expect(one?.textContent).toBe("");
  });

  it("shows the plate behind the cells, or the glass backdrop without one", () => {
    const graphite = themeById("graphite").board;
    expect(draw(graphite).querySelector<HTMLElement>(".preview")?.style.background).toBe(
      hexToRgb(cssColor(graphite.plate ?? 0)),
    );
    const frost = { ...graphite, plate: null };
    expect(draw(frost).querySelector<HTMLElement>(".preview")?.style.background).toBe(
      "var(--glass-preview)",
    );
  });
});

/** jsdom reports colors as `rgb()`. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
