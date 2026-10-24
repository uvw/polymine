import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { themeById } from "../lib/themes/catalog";
import TilingThumb from "./TilingThumb.svelte";

describe("TilingThumb", () => {
  it("draws every polygon in theme colors, cropped to the middle", () => {
    const square = (x: number, y: number) => [
      { x, y },
      { x: x + 1, y },
      { x: x + 1, y: y + 1 },
      { x, y: y + 1 },
    ];
    const polygons = [0, 1, 2, 3].flatMap((y) => [0, 1, 2, 3].map((x) => square(x, y)));
    const { container } = render(TilingThumb, {
      props: { polygons, board: themeById("graphite").board, width: 40, height: 40 },
    });
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0.8 0.8 2.4 2.4");
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(16);
    expect(path).toHaveAttribute("fill", "#667089");
  });
});
