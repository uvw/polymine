import { describe, expect, it, vi } from "vitest";
import * as fake from "../../test/fakePixi";
import { themeById } from "../themes/catalog";
import type { BoardTheme } from "../themes/types";
import { circle, extent, halfPlane, intersectConvex, toward } from "./geometry";

vi.mock("pixi.js", () => fake);

const { LightAtlas, ROWS, glareOutline, lightPixels } = await import("./light");

const board: BoardTheme = {
  ...themeById("graphite").board,
  closed: 0x204080,
  shade: 0x000000,
  shadeAlpha: 0.5,
  shadeDepth: 1,
  gloss: 0xffffff,
  glossAlpha: 0.6,
  glossFade: 0.2,
  glossExtent: 0.5,
  glossShape: "band",
};
const square = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];
const WIDTH = 256;

/** The premultiplied pixel at texel `x` of a row. */
function texel(pixels: Uint8Array, row: (typeof ROWS)[number], x: number) {
  const at = (ROWS.indexOf(row) * 4 * WIDTH + x) * 4;
  return Array.from(pixels.slice(at, at + 4));
}

describe("lightPixels", () => {
  const pixels = lightPixels(board);

  it("holds four texel rows per profile", () => {
    expect(pixels).toHaveLength(WIDTH * 4 * ROWS.length * 4);
  });

  it("runs each body from its own color at the lit edge to its shade at the far one", () => {
    expect(texel(pixels, "closed", 0)).toEqual([0x20, 0x40, 0x80, 255]);
    expect(texel(pixels, "closed", WIDTH - 1)).toEqual([0x10, 0x20, 0x40, 255]);
  });

  it("premultiplies the glare", () => {
    expect(texel(pixels, "gloss", 0)).toEqual([153, 153, 153, 153]);
    expect(texel(pixels, "gloss", WIDTH - 1)).toEqual([51, 51, 51, 51]);
  });
});

describe("LightAtlas.style", () => {
  const atlas = new LightAtlas(board);
  const toTexels = (row: (typeof ROWS)[number], degrees: number) => {
    const style = atlas.style(row, square, degrees) as { matrix: fake.Matrix };
    return style.matrix.invert();
  };

  it("lays a row from the edge facing the light to the far one", () => {
    const top = toTexels("gloss", 0);
    expect(top.apply({ x: 0, y: -10 }).x).toBeCloseTo(1);
    expect(top.apply({ x: 0, y: 10 }).x).toBeCloseTo(WIDTH - 1);
    const left = toTexels("gloss", 270);
    expect(left.apply({ x: -10, y: 0 }).x).toBeCloseTo(1);
  });

  it("samples the middle of its row everywhere on the shape", () => {
    const map = toTexels("closedHover", 30);
    const middle = ROWS.indexOf("closedHover") * 4 + 2;
    for (const p of square) expect(Math.abs(map.apply(p).y - middle)).toBeLessThan(0.26);
  });

  it("frees its texture", () => {
    atlas.destroy();
    expect((atlas.texture as unknown as fake.Texture).destroyed).toBe(true);
  });
});

describe("glareOutline", () => {
  const inner = square.map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }));

  it("cuts a band straight across at its extent", () => {
    const band = glareOutline(square, inner, board);
    expect(extent(band, { x: 0, y: 1 })).toEqual([-9, 0]);
    expect(band.filter((p) => p.from === "subject")).toHaveLength(2);
    expect(band.filter((p) => p.from === "edge")).toHaveLength(2);
  });

  it("bows an arc toward the far edge in the middle", () => {
    const arc = glareOutline(square, inner, { ...board, glossShape: "arc" });
    const [, lowest] = extent(arc, { x: 0, y: 1 });
    expect(lowest).toBeCloseTo(0, 5);
    const sides = arc.filter((p) => p.from === "edge");
    for (const p of sides) expect(p.y).toBeLessThan(-3);
  });

  it("rounds a spot against the lit edge", () => {
    const spot = glareOutline(square, inner, { ...board, glossShape: "spot" });
    const [top, bottom] = extent(spot, { x: 0, y: 1 });
    expect(top).toBeCloseTo(-9, 1);
    expect(bottom).toBeCloseTo(1, 1);
    expect(spot.every((p) => p.from !== "subject")).toBe(true);
  });

  it("follows the light around", () => {
    const right = glareOutline(square, inner, { ...board, lightAngle: 90 });
    const [from, to] = extent(right, { x: 1, y: 0 });
    expect(from).toBeCloseTo(0);
    expect(to).toBeCloseTo(9);
  });
});

describe("intersectConvex", () => {
  it("is empty when the polygons don't meet", () => {
    expect(intersectConvex(square, halfPlane(toward(0), 20, 40))).toEqual([]);
  });

  it("keeps a polygon wholly inside the other", () => {
    const small = circle({ x: 0, y: 0 }, 2, 8);
    expect(intersectConvex(square, small).every((p) => p.from === "clip")).toBe(true);
    expect(intersectConvex(square, small)).toHaveLength(8);
  });
});
