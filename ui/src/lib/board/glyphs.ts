/**
 * A theme's SVG glyphs as textures. Each SVG loads once as an image, which
 * can't run scripts or fetch anything, and is drawn to a canvas at each size
 * the board needs, so it stays sharp at every zoom.
 */
import { CanvasSource, Texture } from "pixi.js";
import { daltonizePixels, type Deficiency } from "../themes/color";
import type { ThemeGlyph } from "../themes/types";

export type ImageLoader = (src: string) => Promise<CanvasImageSource>;

export const loadImage: ImageLoader = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the SVG did not load as an image"));
    image.src = src;
  });

export class GlyphTextures {
  private readonly images = new Map<string, CanvasImageSource | "loading" | "failed">();
  private readonly textures = new Map<string, Texture>();

  /** `loaded` runs whenever an image becomes ready to draw. */
  constructor(
    private readonly loaded: () => void,
    private readonly load: ImageLoader = loadImage,
  ) {}

  /**
   * `glyph` drawn to fit a square `size` CSS pixels wide, or null while its
   * image loads or when it failed, so the caller draws its own glyph instead.
   * With a color filter, its pixels get that filter's correction.
   */
  texture(
    glyph: ThemeGlyph,
    size: number,
    resolution: number,
    filter: Deficiency | null = null,
  ): Texture | null {
    const image = this.images.get(glyph.src);
    if (image === undefined) this.fetch(glyph.src);
    if (image === undefined || image === "loading" || image === "failed") return null;
    const key = `${size.toFixed(1)}@${resolution}|${filter ?? "none"}|${glyph.src}`;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = draw(image, glyph.aspect, size, resolution, filter);
      this.textures.set(key, texture);
    }
    return texture;
  }

  /** Frees every texture. Loaded images stay for the next sizes. */
  clearTextures(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }

  private fetch(src: string): void {
    this.images.set(src, "loading");
    this.load(src).then(
      (image) => {
        this.images.set(src, image);
        this.loaded();
      },
      (error: unknown) => {
        this.images.set(src, "failed");
        console.warn("a theme glyph did not load:", error);
      },
    );
  }
}

function draw(
  image: CanvasImageSource,
  aspect: number,
  size: number,
  resolution: number,
  filter: Deficiency | null,
) {
  const [width, height] = aspect >= 1 ? [size, size / aspect] : [size * aspect, size];
  // The source sizes its own canvas before anything is drawn. Resizing a canvas
  // clears it, and Pixi resizes a canvas handed in whenever its size over the
  // resolution doesn't round-trip, as at 125%.
  const source = new CanvasSource({ width, height, resolution });
  const { width: pixelWidth, height: pixelHeight } = source.resource;
  const context = source.context2D;
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
  if (filter) {
    try {
      const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
      daltonizePixels(pixels.data, filter);
      context.putImageData(pixels, 0, 0);
    } catch (error) {
      console.warn("a theme glyph could not be filtered:", error);
    }
  }
  source.update();
  return new Texture({ source });
}
