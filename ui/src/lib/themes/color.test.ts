import { describe, expect, it } from "vitest";
import {
  daltonize,
  daltonizePixels,
  distance,
  fromLinear,
  linear,
  simulate,
  type Deficiency,
} from "./color";

const DEFICIENCIES: Deficiency[] = ["deuteranopia", "protanopia", "tritanopia"];

const corrected = (hex: number, deficiency: Deficiency) =>
  fromLinear(daltonize(linear(hex), deficiency));

describe("daltonize", () => {
  it.each(DEFICIENCIES)("leaves grays alone for %s", (deficiency) => {
    for (const gray of [0x000000, 0x404040, 0x808080, 0xc0c0c0, 0xffffff]) {
      expect(corrected(gray, deficiency)).toBe(gray);
    }
  });

  it.each([
    ["deuteranopia", 0xe53935, 0x43a047],
    ["protanopia", 0xe53935, 0x43a047],
    ["tritanopia", 0x3060ff, 0x30c060],
  ] as const)("pulls apart colors %s confuses", (deficiency, a, b) => {
    const seen = (hex: number) => simulate(hex, deficiency);
    const before = distance(seen(a), seen(b));
    const after = distance(seen(corrected(a, deficiency)), seen(corrected(b, deficiency)));
    expect(after).toBeGreaterThan(before + 10);
  });
});

describe("daltonizePixels", () => {
  it("corrects every pixel with some opacity and skips clear ones", () => {
    const data = new Uint8ClampedArray([229, 57, 53, 255, 229, 57, 53, 128, 229, 57, 53, 0]);
    daltonizePixels(data, "deuteranopia");
    const red = corrected(0xe53935, "deuteranopia");
    const rgb = [(red >> 16) & 255, (red >> 8) & 255, red & 255];
    expect([...data]).toEqual([...rgb, 255, ...rgb, 128, 229, 57, 53, 0]);
  });
});
