/** The system accent color and theme chrome tokens, as inline properties on `<html>`. */
import { contrast, cssColor, mix } from "./color";
import { CHROME_TOKENS, SYSTEM_ACCENT } from "./format";
import type { Theme } from "./types";

/** The chrome's accent tokens for `accent`, with text that reads on it. */
export function accentTokens(accent: number): Record<string, string> {
  const onAccent = contrast(accent, 0x000000) > contrast(accent, 0xffffff) ? 0x000000 : 0xffffff;
  return {
    "--accent": cssColor(accent),
    "--accent-hover": cssColor(mix(accent, onAccent, 0.12)),
    "--on-accent": cssColor(onAccent),
  };
}

/**
 * Every property the theme and the accent control on `<html>`, with null for
 * the ones to remove so `app.css` applies. The system accent replaces the
 * chrome's accent unless the theme sets `--accent` itself. `accent` is null
 * when there is none or the player turned the tint off.
 */
export function chromeStyle(theme: Theme, accent: number | null): Record<string, string | null> {
  const style: Record<string, string | null> = {};
  const system = accent !== null && !("--accent" in theme.chrome) ? accentTokens(accent) : {};
  for (const token of [...CHROME_TOKENS, ...Object.keys(accentTokens(0))]) {
    style[token] = theme.chrome[token] ?? system[token] ?? null;
  }
  style[SYSTEM_ACCENT] = accent === null ? null : cssColor(accent);
  style["color-scheme"] = theme.scheme === "system" ? null : theme.scheme;
  return style;
}
