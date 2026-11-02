import type { Deficiency } from "./color";
import type { BoardEffect, GlyphName, Relaxation, ThemeMeta, ThemeSheet } from "./format";

/** How open cells show their count. */
export type NumberStyle = "digits" | "colors";

/** The glare's outline: cut straight, bowed like a glazed dome, or a round spot. */
export type GlossShape = "band" | "arc" | "spot";

export type FontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

/** An SVG file from a theme, ready to load as an image. */
export interface ThemeGlyph {
  /** A `data:` URL, so the SVG loads as an image that can't run scripts or fetch. */
  src: string;
  /** Width over height, from the SVG's `viewBox` or size. */
  aspect: number;
}

/** Colors and shapes for the minefield. Colors are 0xRRGGBB. */
export interface BoardTheme {
  /** Tray behind the cells. `null` lets the window background show through. */
  plate: number | null;
  /** Opacity of the plate, from 0 to 1. */
  plateAlpha: number;
  closed: number;
  closedHover: number;
  closedPressed: number;
  closedEdge: number;
  /** Opacity of closed cells, from 0 to 1. */
  closedAlpha: number;
  /** Raised-tile sheen on closed cells, drawn at `sheenAlpha`. */
  sheen: number;
  sheenAlpha: number;
  /** Width of the rim around the sheen on closed cells, as a share of the inradius. */
  bevel: number;
  open: number;
  openEdge: number;
  /** Opacity of open cells, from 0 to 1. */
  openAlpha: number;
  /** The opened mine's cell, the cross on a wrong flag, and the blast glow. */
  exploded: number;
  /** Where the light on cells comes from, in degrees clockwise from the top. */
  lightAngle: number;
  /** The glare on closed cells, from `glossAlpha` at its lit end to `glossFade` at the other. */
  gloss: number;
  glossAlpha: number;
  glossFade: number;
  /** How far the glare reaches from the lit edge, as a share of the cell. */
  glossExtent: number;
  glossShape: GlossShape;
  /** Peak opacity of the glint that sweeps a closed cell under the pointer; 0 for none. */
  glintAlpha: number;
  /** A light line inside the edges of closed cells that face `rimAngle`. */
  rim: number;
  rimAlpha: number;
  /** Width of the rim light in CSS pixels. */
  rimWidth: number;
  rimAngle: number;
  /**
   * Shade that makes closed cells read as raised, darkest at the edge away
   * from the light, and `openShade` that makes open ones read as recessed,
   * darkest under the lit edge.
   */
  shade: number;
  shadeAlpha: number;
  openShade: number;
  openShadeAlpha: number;
  /** How far the shade reaches into the cell, as a share of the cell. */
  shadeDepth: number;
  flag: number;
  /** Thin outline that keeps the flag visible on closed cells. */
  flagOutline: number;
  flagPole: number;
  question: number;
  /** An edge around the question mark, or null for none. */
  questionOutline: number | null;
  mine: number;
  mineSpark: number;
  /** Spikes around the mine: 4 for a clean cross, 8 for a classic star. */
  mineSpikes: number;
  hint: number;
  focus: number;
  win: number;
  /**
   * Colors for counts from 1 up. With digits, larger counts wrap around the
   * list; as colors, the last one stands for every larger count.
   */
  numbers: readonly number[];
  numberStyle: NumberStyle;
  /** With `colors`, counts from this one up draw as a ring; null draws every count solid. */
  numberRingFrom: number | null;
  /** A soft shadow under digits, cast away from the light; `numberShadowAlpha` 0 for none. */
  numberShadow: number;
  numberShadowAlpha: number;
  fontFamily: string;
  fontWeight: FontWeight;
  /** Gap between cells in CSS pixels. */
  gap: number;
  /**
   * Corner radius as a share of the cell's inradius, capped at 6 px, or at
   * half the gap on triangles.
   */
  rounding: number;
  /** SVG files that replace drawn marks and numbers. */
  glyphs: Readonly<Partial<Record<GlyphName, ThemeGlyph>>>;
  /** The color filter these colors went through. SVG glyphs get its pixel correction when drawn. */
  filter: Deficiency | null;
  /** Built-in shaders drawn over the board, in order; empty for none. */
  effects: readonly BoardEffect[];
}

/** A theme as loaded from its folder, before its variables are resolved. */
export interface ThemeEntry {
  /** The folder name. */
  id: string;
  builtIn: boolean;
  /** `theme.css` as read, to tell a changed file from an unchanged one. */
  css: string;
  sheet: ThemeSheet;
  /** SVG glyphs loaded so far. A player theme's arrive once it's chosen. */
  glyphs: Readonly<Partial<Record<GlyphName, ThemeGlyph>>>;
  /** Glyph files the folder holds, loaded or not. */
  glyphNames: readonly GlyphName[];
  /** URL of `preview.png`, when the folder has one. */
  preview: string | null;
}

/** Colors the theme sets for the app icon. A null color follows the board. */
export interface IconTheme {
  /** Whether the theme resolved for dark mode, which picks a dark or light plate. */
  dark: boolean;
  plate: number | null;
  /** The spikes, the halo behind the mine, and the plate's edge. */
  metal: number | null;
  mine: number | null;
  /** The lit tip of one spike. */
  spark: number | null;
}

/** A complete look: window chrome plus minefield, resolved for the moment. */
export interface Theme {
  id: string;
  meta: ThemeMeta;
  /** Test checks this built-in theme relaxes. */
  relaxed: ReadonlySet<Relaxation>;
  /** Follows the system's light or dark mode, or fixes one. */
  scheme: "system" | "light" | "dark";
  /** The window backdrop: the platform default, a frosted blur, or none. */
  material: "default" | "frosted" | "none";
  /** Chrome tokens the theme sets, by name, as values to put on `<html>`. */
  chrome: Readonly<Record<string, string>>;
  board: BoardTheme;
  icon: IconTheme;
  preview: string | null;
}

/** A player theme that didn't load, and why. */
export interface SkippedTheme {
  id: string;
  reason: string;
}
