import type { Platform } from "./bindings";

/** Unknown until startup applies the shell's environment. */
let current = $state<Platform | null>(null);

/** Tags `<html>` so CSS can follow each platform's conventions. */
export function applyEnvironment(platform: Platform, material: boolean): void {
  current = platform;
  const root = document.documentElement;
  root.classList.remove("platform-windows", "platform-macos", "platform-linux");
  root.classList.add(`platform-${platform}`);
  root.classList.toggle("has-material", material);
}

export function platform(): Platform | null {
  return current;
}

/**
 * Shortcut text in the platform's style. `mod` means Cmd on macOS and Ctrl
 * elsewhere: `shortcut("N", { mod: true })` gives "⌘N" or "Ctrl+N".
 */
export function shortcut(key: string, options: { mod?: boolean } = {}): string {
  if (!options.mod) return key;
  return current === "macos" ? `⌘${key}` : `Ctrl+${key}`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
