import { describe, expect, it } from "vitest";
import { themeById } from "./catalog";
import { mix } from "./color";
import {
  PLAIN,
  backdropLooks,
  backdrops,
  bodies,
  bodyAt,
  glossAt,
  hasLight,
  look,
  previewLight,
  rimAt,
  seenUnder,
  shadeAt,
} from "./gloss";
import type { BoardTheme } from "./types";

const flat = themeById("graphite").board;
const lit: BoardTheme = {
  ...flat,
  closed: 0x2050a0,
  open: 0xf0f0f0,
  shade: 0x000000,
  shadeAlpha: 0.3,
  openShade: 0x000000,
  openShadeAlpha: 0.1,
  shadeDepth: 0.5,
  gloss: 0xffffff,
  glossAlpha: 0.6,
  glossFade: 0.1,
  glossExtent: 0.4,
  rim: 0xffffff,
  rimAlpha: 0.5,
  rimWidth: 1,
  lightAngle: 0,
};

describe("profiles", () => {
  it("shades a raised cell away from the light and a recessed one under it", () => {
    expect(shadeAt("raised", 0.5, 0)).toBe(0);
    expect(shadeAt("raised", 0.5, 0.5)).toBe(0);
    expect(shadeAt("raised", 0.5, 1)).toBe(1);
    expect(shadeAt("recessed", 0.5, 0)).toBe(1);
    expect(shadeAt("recessed", 0.5, 0.5)).toBe(0);
    expect(shadeAt("raised", 0.5, 0.75)).toBeCloseTo(0.5);
  });

  it("mixes the shade into the body, and fades the glare and the rim", () => {
    expect(bodyAt(lit, lit.closed, "raised", 0)).toBe(lit.closed);
    expect(bodyAt(lit, lit.closed, "raised", 1)).toBe(mix(lit.closed, 0, 0.3));
    expect(bodyAt(lit, lit.open, "recessed", 0)).toBe(mix(lit.open, 0, 0.1));
    expect(glossAt(lit, 0).alpha).toBeCloseTo(0.6);
    expect(glossAt(lit, 1).alpha).toBeCloseTo(0.1);
    expect(rimAt(lit, 0).alpha).toBeCloseTo(0.5);
    expect(rimAt(lit, 0.9).alpha).toBe(0);
  });

  it("knows a theme with no light", () => {
    expect(hasLight(flat)).toBe(false);
    expect(hasLight(lit)).toBe(true);
    expect(hasLight({ ...flat, rimAlpha: 1, rimWidth: 0 })).toBe(false);
  });
});

describe("looks", () => {
  it("blend as the screen does, layer over layer", () => {
    expect(seenUnder(0x204060, PLAIN)).toBe(0x204060);
    expect(seenUnder(0x204060, look([{ color: 0xffffff, alpha: 0.5 }]))).toBe(
      mix(0x204060, 0xffffff, 0.5),
    );
    const two = look([
      { color: 0x000000, alpha: 0.5 },
      { color: 0xffffff, alpha: 0.5 },
    ]);
    expect(seenUnder(0x804020, two)).toBe(mix(mix(0x804020, 0, 0.5), 0xffffff, 0.5));
  });

  it("put a flat theme's marks on its plain colors", () => {
    expect(backdropLooks(flat, "closed")).toEqual([PLAIN]);
    expect(backdrops(flat, "closed")).toEqual([flat.closed]);
    expect(bodies(flat, "open")).toEqual([flat.open]);
  });

  it("put marks on each end of the shade, under the glare at its strongest and faintest", () => {
    expect(bodies(lit, "closed")).toEqual([lit.closed, mix(lit.closed, 0, 0.3)]);
    expect(bodies(lit, "open")).toEqual([lit.open, mix(lit.open, 0, 0.1)]);
    const closed = backdrops(lit, "closed");
    expect(closed).toHaveLength(6);
    expect(closed).toContain(mix(lit.closed, 0xffffff, 0.6));
    const shadedFaint = look([
      { color: 0x000000, alpha: 0.3 },
      { color: 0xffffff, alpha: 0.1 },
    ]);
    expect(closed).toContain(seenUnder(lit.closed, shadedFaint));
    expect(backdrops(lit, "exploded")).toEqual([lit.exploded, mix(lit.exploded, 0, 0.1)]);
  });
});

describe("previewLight", () => {
  it("draws nothing for a flat theme", () => {
    expect(previewLight(flat, "closed")).toBeNull();
    expect(previewLight(flat, "open")).toBeNull();
  });

  it("draws the glare and the shade from the far side of the light", () => {
    const closed = previewLight({ ...lit, lightAngle: 350 }, "closed");
    expect(closed).toContain("linear-gradient(170deg, rgb(255 255 255 / 60%)");
    expect(closed).toContain("rgb(255 255 255 / 10%) 40%, transparent 40%");
    expect(closed).toContain("rgb(0 0 0 / 0%) 50%, rgb(0 0 0 / 30%)");
    expect(previewLight(lit, "open")).toBe(
      "linear-gradient(180deg, rgb(0 0 0 / 10%), rgb(0 0 0 / 0%) 50%)",
    );
  });
});
