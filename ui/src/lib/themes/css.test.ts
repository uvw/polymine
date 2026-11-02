import { describe, expect, it } from "vitest";
import { evaluateColor, splitTop, substitute, toHex } from "./css";
import { mix } from "./color";

const vars = new Map([
  ["--a", "#ff0000"],
  ["--b", "var(--a)"],
  ["--loop", "var(--loop)"],
]);
const lookup = (name: string) => vars.get(name);

describe("substitute", () => {
  it("fills references in turn, with fallbacks for unknown names", () => {
    expect(substitute("mix(var(--b), var(--none, var(--a)))", lookup)).toBe(
      "mix(#ff0000, #ff0000)",
    );
  });

  it("gives null for a reference it can't fill, or a loop", () => {
    expect(substitute("var(--none)", lookup)).toBeNull();
    expect(substitute("var(--loop)", lookup)).toBeNull();
    expect(substitute("var(--a", lookup)).toBeNull();
  });

  it("keeps unknown references for the browser when asked", () => {
    expect(substitute("var(--x)", lookup, true)).toBe("var(--x)");
    expect(substitute("var(--x, var(--b))", lookup, true)).toBe("var(--x, #ff0000)");
  });
});

describe("splitTop", () => {
  it("splits outside parentheses, up to a limit", () => {
    expect(splitTop("a, f(b, c), d", ",")).toEqual(["a", " f(b, c)", " d"]);
    expect(splitTop("a, b, c", ",", 2)).toEqual(["a", " b, c"]);
  });
});

describe("evaluateColor", () => {
  const hex = (css: string, dark = false) => {
    const color = evaluateColor(css, dark);
    return color && [toHex(color), Number(color.a.toFixed(3))];
  };

  it("reads hex, rgb(), color(srgb), and the plain names", () => {
    expect(hex("#abc")).toEqual([0xaabbcc, 1]);
    expect(hex("#abcd")).toEqual([0xaabbcc, 0.867]);
    expect(hex("#A1B2C3")).toEqual([0xa1b2c3, 1]);
    expect(hex("#a1b2c380")).toEqual([0xa1b2c3, 0.502]);
    expect(hex("rgb(1, 2, 3)")).toEqual([0x010203, 1]);
    expect(hex("rgba(255, 255, 255, 0.07)")).toEqual([0xffffff, 0.07]);
    expect(hex("rgb(255 255 255 / 7%)")).toEqual([0xffffff, 0.07]);
    expect(hex("rgb(100% 0% 50%)")).toEqual([0xff0080, 1]);
    expect(hex("color(srgb 1 0.5 0 / 0.5)")).toEqual([0xff8000, 0.5]);
    expect(hex("transparent")).toEqual([0, 0]);
    expect(hex("White")).toEqual([0xffffff, 1]);
  });

  it("picks the light or the dark side of light-dark()", () => {
    expect(hex("light-dark(#ffffff, #000000)")).toEqual([0xffffff, 1]);
    expect(hex("light-dark(#ffffff, #000000)", true)).toEqual([0, 1]);
  });

  it("mixes in sRGB the way mix() does for opaque colors", () => {
    expect(hex("color-mix(in srgb, #737e99, #0078d4 35%)")).toEqual([
      mix(0x737e99, 0x0078d4, 0.35),
      1,
    ]);
    expect(hex("color-mix(in srgb, 25% #000000, #ffffff)")).toEqual([0xbfbfbf, 1]);
    expect(hex("color-mix(in srgb, #000000, #ffffff)")).toEqual([0x808080, 1]);
    expect(hex("color-mix(in srgb, #000000 30%, #ffffff 30%)")).toEqual([0x808080, 0.6]);
  });

  it("mixes see-through colors with premultiplied alpha", () => {
    expect(hex("color-mix(in srgb, #ff0000 50%, transparent)")).toEqual([0xff0000, 0.5]);
    expect(hex("color-mix(in srgb, transparent, transparent)")).toEqual([0, 0]);
  });

  it("leaves everything else to the browser", () => {
    for (const css of [
      "oklch(0.7 0.1 200)",
      "color(display-p3 1 0 0)",
      "color-mix(in oklab, red, blue)",
      "color-mix(in srgb, red)",
      "color-mix(in srgb, nope, red)",
      "color-mix(in srgb, red -10%, blue)",
      "light-dark(red)",
      "rgb(1, 2)",
      "rgb(1, 2, 3, 4, 5)",
      "rgb(a b c)",
      "#12345",
      "#ggg",
      "papayawhip",
      "hsl(0 100% 50%)",
    ]) {
      expect(evaluateColor(css, false), css).toBeNull();
    }
  });
});

describe("toHex", () => {
  it("rounds and clamps each channel", () => {
    expect(toHex({ r: 300, g: -4, b: 127.5, a: 1 })).toBe(0xff0080);
  });
});
