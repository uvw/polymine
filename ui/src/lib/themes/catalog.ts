import { EXPERIMENTAL_THEMES, loadBuiltIns, RENAMED_BUILT_INS } from "./builtin";
import { defaultColors, resolveTheme, type ColorLookup, type ThemeEnv } from "./resolve";
import type { BoardTheme, Theme, ThemeEntry } from "./types";

/** Development builds list the experiments, and so does a build made with `VITE_EXPERIMENTS=1`. */
const EXPERIMENTS = import.meta.env.DEV || import.meta.env.VITE_EXPERIMENTS === "1";

export const BUILT_IN_THEMES: readonly ThemeEntry[] = loadBuiltIns().filter(
  (entry) => EXPERIMENTS || !EXPERIMENTAL_THEMES.includes(entry.id),
);

export const DEFAULT_THEME_ID = "frost";

/**
 * The theme with this id, or with the id a renamed built-in theme took, or
 * the default for ids from newer builds and removed folders.
 */
export function findTheme(entries: readonly ThemeEntry[], id: string | undefined): ThemeEntry {
  const wanted = id === undefined ? id : (RENAMED_BUILT_INS.get(id) ?? id);
  return (
    entries.find((entry) => entry.id === wanted) ??
    entries.find((entry) => entry.id === DEFAULT_THEME_ID) ??
    (BUILT_IN_THEMES[0] as ThemeEntry)
  );
}

/** Messages already logged. Themes are read again on every focus, and each problem is logged once. */
const logged = new Set<string>();

export function warnOnce(message: string): void {
  if (logged.has(message)) return;
  logged.add(message);
  console.warn(message);
}

let colors: ColorLookup | null = null;
const resolved = new WeakMap<ThemeEntry, Map<string, Theme>>();

/**
 * `entry` resolved for `env`. Results are kept per entry, so redrawing with
 * the same accent and mode costs nothing and each warning is logged once.
 */
export function themeFor(entry: ThemeEntry, env: ThemeEnv): Theme {
  let byEnv = resolved.get(entry);
  if (!byEnv) resolved.set(entry, (byEnv = new Map()));
  const key = `${env.accent}|${env.dark}`;
  let theme = byEnv.get(key);
  if (!theme) {
    colors ??= defaultColors();
    theme = resolveTheme(entry, env, colors, (message) =>
      warnOnce(`theme ${entry.id}: ${message}`),
    );
    byEnv.set(key, theme);
  }
  return theme;
}

/** A built-in theme by id, with no accent and in light mode unless `env` says otherwise. */
export function themeById(
  id: string | undefined,
  env: ThemeEnv = { accent: null, dark: false },
): Theme {
  return themeFor(findTheme(BUILT_IN_THEMES, id), env);
}

export function numberColor(board: BoardTheme, n: number): number {
  return board.numbers[(n - 1) % board.numbers.length] ?? 0xffffff;
}
