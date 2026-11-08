import type { ThemeRotation } from "../bindings";
import { themeGroup, type ThemeGroup } from "./builtin";
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
  favorites: readonly string[];
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
