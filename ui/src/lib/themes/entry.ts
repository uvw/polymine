/** Building a theme entry from the files of a theme folder. */
import { GLYPHS, parseThemeCss, type GlyphName } from "./format";
import type { ThemeEntry, ThemeGlyph } from "./types";

export const isGlyphName = (name: string): name is GlyphName =>
  (GLYPHS as readonly string[]).includes(name);

/** What a theme folder holds besides `theme.css`. */
export interface ThemeFiles {
  /** SVG text by glyph name, for the glyphs read so far. */
  svgs?: Partial<Record<GlyphName, string>>;
  /** Every glyph file in the folder, when not all of them were read. */
  glyphNames?: readonly GlyphName[];
  /** URL of `preview.png`. */
  preview?: string | null;
}

/** Parses a theme folder's files. Throws a `ThemeError` when `theme.css` breaks the format. */
export function themeEntry(
  id: string,
  css: string,
  builtIn: boolean,
  files: ThemeFiles = {},
): ThemeEntry {
  const glyphs: Partial<Record<GlyphName, ThemeGlyph>> = {};
  for (const [name, svg] of Object.entries(files.svgs ?? {})) {
    if (isGlyphName(name) && svg !== undefined) glyphs[name] = svgGlyph(svg);
  }
  return {
    id,
    builtIn,
    css,
    sheet: parseThemeCss(css, builtIn),
    glyphs,
    glyphNames: files.glyphNames ?? (Object.keys(glyphs) as GlyphName[]),
    preview: files.preview ?? null,
  };
}

/**
 * An SVG file as a glyph: a `data:` URL, which an image loads without running
 * scripts or fetching anything, and its aspect ratio.
 */
export function svgGlyph(svg: string): ThemeGlyph {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const attribute = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const box = attribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const size = [attribute("width"), attribute("height")].map((v) => parseFloat(v ?? ""));
  const [w, h] =
    box?.length === 4 && box[2] && box[3] ? [box[2], box[3]] : [size[0] ?? NaN, size[1] ?? NaN];
  const aspect = w > 0 && h > 0 ? w / h : 1;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, aspect };
}
