import { afterEach, describe, expect, it, vi } from "vitest";
import * as fake from "../../test/fakePixi";

vi.mock("pixi.js", () => fake);

const { GlyphTextures, loadImage } = await import("./glyphs");

const glyph = { src: "data:image/svg+xml,%3Csvg/%3E", aspect: 2 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe("GlyphTextures", () => {
  it("draws nothing until the image loads, then a texture per size, kept until cleared", async () => {
    const image = {} as CanvasImageSource;
    const loaded = vi.fn();
    const load = vi.fn(() => Promise.resolve(image));
    const textures = new GlyphTextures(loaded, load);

    expect(textures.texture(glyph, 20, 2)).toBeNull();
    expect(textures.texture(glyph, 20, 2)).toBeNull();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledTimes(1);

    const texture = textures.texture(glyph, 20, 2) as unknown as fake.Texture;
    expect(texture).toBeInstanceOf(fake.Texture);
    expect(textures.texture(glyph, 20, 2)).toBe(texture);
    // Wider than tall: 20 by 10 CSS pixels at twice the density.
    const source = texture.options.source;
    expect(source.options).toEqual({ width: 20, height: 10, resolution: 2 });
    expect(source.drawn).toEqual([[image, 0, 0, 40, 20]]);
    expect(source.updated).toBe(1);

    const tall = textures.texture({ ...glyph, aspect: 0.5 }, 20, 1) as unknown as fake.Texture;
    expect(tall.options.source.drawn).toEqual([[image, 0, 0, 10, 20]]);

    textures.clearTextures();
    expect(texture.destroyed).toBe(true);
    expect(textures.texture(glyph, 20, 2)).not.toBe(texture);
  });

  it("corrects a filtered glyph's pixels, in a texture of its own", async () => {
    const textures = new GlyphTextures(vi.fn(), () => Promise.resolve({} as CanvasImageSource));
    textures.texture(glyph, 2, 1);
    await flush();
    const plain = textures.texture(glyph, 2, 1) as unknown as fake.Texture;
    const filtered = textures.texture(glyph, 2, 1, "deuteranopia") as unknown as fake.Texture;
    expect(filtered).not.toBe(plain);
    expect(textures.texture(glyph, 2, 1, "deuteranopia")).toBe(filtered);
    expect(plain.options.source.put).toEqual([]);
    const [pixels] = filtered.options.source.put;
    // Two by one pixels of red, which turns bluer for a deuteranope.
    expect(pixels).toHaveLength(8);
    expect(pixels?.[2]).toBeGreaterThan(100);
    expect(pixels?.[3]).toBe(255);
  });

  it("draws a glyph as it is when its pixels can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const textures = new GlyphTextures(vi.fn(), () => Promise.resolve({} as CanvasImageSource));
    textures.texture(glyph, 2, 1);
    await flush();
    fake.CanvasSource.tainted = true;
    try {
      const texture = textures.texture(glyph, 2, 1, "tritanopia") as unknown as fake.Texture;
      expect(texture.options.source.put).toEqual([]);
      expect(texture.options.source.updated).toBe(1);
    } finally {
      fake.CanvasSource.tainted = false;
    }
    expect(console.warn).toHaveBeenCalledWith(
      "a theme glyph could not be filtered:",
      expect.any(Error),
    );
  });

  it("falls back for good when an image fails to load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const textures = new GlyphTextures(vi.fn(), () => Promise.reject(new Error("broken")));
    expect(textures.texture(glyph, 20, 1)).toBeNull();
    await flush();
    expect(textures.texture(glyph, 20, 1)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("a theme glyph did not load:", expect.any(Error));
  });
});

describe("loadImage", () => {
  it("settles when the image loads or fails", async () => {
    const images: HTMLImageElement[] = [];
    vi.spyOn(window, "Image").mockImplementation(function (this: HTMLImageElement) {
      const image = document.createElement("img");
      images.push(image);
      return image;
    } as never);
    const ok = loadImage("data:image/svg+xml,a");
    images[0]?.onload?.(new Event("load"));
    await expect(ok).resolves.toBe(images[0]);
    const bad = loadImage("data:image/svg+xml,b");
    images[1]?.onerror?.(new Event("error"));
    await expect(bad).rejects.toThrow("did not load");
  });
});
