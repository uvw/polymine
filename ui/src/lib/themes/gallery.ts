import type { ThemeRotation } from "../bindings";
import { themeGroup, type ThemeGroup } from "./builtin";
import { themeFor } from "./catalog";
import { linear, oklab } from "./color";
import type { ThemeEntry } from "./types";

/** Which themes the gallery lists: one group, the player's favorites, or all. */
export type ThemeSource = "all" | ThemeGroup | "favorites";

/** The modes a theme shows: one fixed mode, or both as the system switches. */
export type ThemeMode = "light" | "dark" | "both";

export interface GalleryFilter {
  query: string;
  source: ThemeSource;
  /** Themes that show this mode, both-mode themes included, or null for any. */
  mode: "light" | "dark" | null;
  /** Only black and white themes. */
  mono: boolean;
  favorites: readonly string[];
}

/** Most OKLab chroma a black and white theme's cells may carry, a paper's tint. */
const GRAY_CELLS = 0.035;
/** Most chroma its counts may carry: near-black inks with a faint tint each. */
const GRAY_INKS = 0.1;

const chroma = (hex: number) => {
  const [, a, b] = oklab(linear(hex));
  return Math.hypot(a, b);
};

const monochrome = new WeakMap<ThemeEntry, boolean>();

/** Whether the theme's cells are gray and its counts nearly so, in both modes. */
export function isMonochrome(entry: ThemeEntry): boolean {
  let known = monochrome.get(entry);
  if (known === undefined) {
    known = [false, true].every((dark) => {
      const board = themeFor(entry, { accent: null, dark }).board;
      return (
        [board.closed, board.open].every((c) => chroma(c) <= GRAY_CELLS) &&
        board.numbers.every((c) => chroma(c) <= GRAY_INKS)
      );
    });
    monochrome.set(entry, known);
  }
  return known;
}

const GROUP_ORDER: readonly ThemeGroup[] = ["polymine", "editor", "player"];

export function themeMode(entry: ThemeEntry): ThemeMode {
  const scheme = entry.sheet.declarations.get("--color-scheme")?.trim();
  return scheme === "light" || scheme === "dark" ? scheme : "both";
}

/** Entries that pass every part of `filter`, in their catalog order. */
export function filterThemes(entries: readonly ThemeEntry[], filter: GalleryFilter): ThemeEntry[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter.source === "favorites") {
      if (!filter.favorites.includes(entry.id)) return false;
    } else if (filter.source !== "all" && themeGroup(entry) !== filter.source) {
      return false;
    }
    if (filter.mono && !isMonochrome(entry)) return false;
    if (filter.mode) {
      const mode = themeMode(entry);
      if (mode !== "both" && mode !== filter.mode) return false;
    }
    const { name, description, author } = entry.sheet.meta;
    const text = `${name} ${description} ${author}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The entries by group, Signature first, with empty groups left out. */
export function gallerySections(
  entries: readonly ThemeEntry[],
): { group: ThemeGroup; themes: ThemeEntry[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    themes: entries.filter((entry) => themeGroup(entry) === group),
  })).filter((section) => section.themes.length > 0);
}

/** The ids in `ids` that name a theme in `entries`, in their order. */
export function knownIds(entries: readonly ThemeEntry[], ids: readonly string[]): string[] {
  return ids.filter((id) => entries.some((entry) => entry.id === id));
}

/** The themes a new game may switch to: two or more favorites, else every theme. */
export function rotationPool(
  entries: readonly ThemeEntry[],
  rotation: ThemeRotation,
  favorites: readonly string[],
): ThemeEntry[] {
  if (rotation === "off") return [];
  const starred = entries.filter((entry) => favorites.includes(entry.id));
  return rotation === "favorites" && starred.length >= 2 ? starred : [...entries];
}

/** A random theme from `pool` other than `current`, or null when there's none. */
export function pickTheme(
  pool: readonly ThemeEntry[],
  current: string,
  random: () => number = Math.random,
): string | null {
  const others = pool.filter((entry) => entry.id !== current);
  return others[Math.floor(random() * others.length)]?.id ?? null;
}
