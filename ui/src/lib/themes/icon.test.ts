import { afterEach, describe, expect, it, vi } from "vitest";
import { themeEntry } from "./entry";
import { iconColors, iconPixels, iconPng, iconSvg } from "./icon";
import { resolveTheme, staticColors, type ThemeEnv } from "./resolve";

const HEADER = "/*\n * Name: T\n * Author: A\n * Description: D\n * Version: 1\n * Format: 1\n */";
const DARK: ThemeEnv = { accent: null, dark: true };
const LIGHT: ThemeEnv = { accent: null, dark: false };

const theme = (body: string, env = DARK) =>
  resolveTheme(themeEntry("test", `${HEADER}\n:root { ${body} }`, false), env, staticColors);

afterEach(() => vi.restoreAllMocks());

describe("iconColors", () => {
  it("takes the board's colors when the plate fits the mode", () => {
    const body =
      "--board-plate: #101010; --cell-closed: #667089; --mine: #000000; --mine-spark: #ff0000;";
    expect(iconColors(theme(body))).toEqual({
      plate: 0x101010,
      metal: 0x667089,
      mine: 0x000000,
      spark: 0xff0000,
    });
  });

  it("swaps a dark board's plate for a light one in light mode, and back", () => {
    const dark = "--board-plate: #101010; --cell-closed: #667089;";
    const lightPlate = iconColors(theme(dark, LIGHT)).plate;
    expect(lightPlate).toBeGreaterThan(0xd00000);
    const light = "--color-scheme: light dark; --board-plate: #f0f0f0;";
    expect(iconColors(theme(light, DARK)).plate).toBeLessThan(0x303030);
    expect(iconColors(theme(light, LIGHT)).plate).toBe(0xf0f0f0);
  });

  it("uses the open cell when the plate is none", () => {
    expect(iconColors(theme("--board-plate: none; --cell-open: #121830;")).plate).toBe(0x121830);
  });

  it("lets the theme's icon variables win", () => {
    const body =
      "--icon-plate: #202020; --icon-metal: #3366ff; --icon-mine: #111111; --icon-spark: #00ff00;";
    expect(iconColors(theme(body, LIGHT))).toEqual({
      plate: 0x202020,
      metal: 0x3366ff,
      mine: 0x111111,
      spark: 0x00ff00,
    });
  });
});

describe("iconSvg", () => {
  const colors = { plate: 0x101010, metal: 0x667089, mine: 0, spark: 0xff0000 };

  it("draws eight spikes with one lit tip", () => {
    const svg = iconSvg(colors);
    expect(svg.match(/<line /g)).toHaveLength(8);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).not.toContain("<path");
  });

  it("adds the lattice only when asked", () => {
    expect(iconSvg(colors, { lattice: true })).toContain("<path");
  });
});

// jsdom doesn't load images, so it has no `decode`.
function stubImage() {
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    value: () => Promise.resolve(),
    configurable: true,
  });
}

describe("iconPixels", () => {
  it("draws the SVG on a canvas and returns its RGBA bytes", async () => {
    stubImage();
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(7);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: () => ({ data }),
    } as never);
    const pixels = await iconPixels("<svg/>", 4);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 4, 4);
    expect(pixels).toHaveLength(64);
    expect(pixels?.[0]).toBe(7);
  });

  it("gives null without a 2D canvas", async () => {
    stubImage();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
    expect(await iconPixels("<svg/>", 4)).toBeNull();
  });
});

describe("iconPng", () => {
  it("draws the SVG on a canvas and returns it as a PNG file", async () => {
    stubImage();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done) => done(new Blob([new Uint8Array([137, 80, 78, 71])])));
    const png = await iconPng("<svg/>", 8);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 8, 8);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(Array.from(png ?? [])).toEqual([137, 80, 78, 71]);
  });

  it("gives null when the canvas can't make a PNG", async () => {
    stubImage();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(null));
    expect(await iconPng("<svg/>", 8)).toBeNull();
  });

  it("gives null without a 2D canvas", async () => {
    stubImage();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
    expect(await iconPng("<svg/>", 8)).toBeNull();
  });
});
