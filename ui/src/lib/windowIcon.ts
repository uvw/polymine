/**
 * Shows the theme's icon on the window: the title bar, taskbar, and Alt+Tab,
 * or the Dock and the app switcher on macOS.
 */

import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import type { Platform } from "./bindings";
import { iconColors, iconPixels, iconPng, iconSvg } from "./themes/icon";
import type { Theme } from "./themes/types";

/** Big enough for the taskbar at 200% scaling, which wants 64 pixels. */
export const WINDOW_ICON_SIZE = 64;
/** Apple's app icon size, 512 pt at 2x, which the Dock scales down from. */
export const DOCK_ICON_SIZE = 1024;

/**
 * Sets the window's icon to `theme`'s, unless `current` says a newer request
 * replaced this one while the icon was drawn. macOS has no window icon, so
 * there the icon goes to the Dock instead.
 */
export async function applyWindowIcon(
  theme: Theme,
  platform: Platform,
  current = () => true,
): Promise<void> {
  const svg = iconSvg(iconColors(theme));
  if (platform === "macos") {
    const png = await iconPng(svg, DOCK_ICON_SIZE);
    if (png && current()) await api.setDockIcon(Array.from(png));
    return;
  }
  const rgba = await iconPixels(svg, WINDOW_ICON_SIZE);
  if (!rgba || !current()) return;
  const image = await Image.new(rgba, WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
  try {
    await getCurrentWindow().setIcon(image);
  } finally {
    await image.close();
  }
  // Tauri sets only the small icon; the taskbar and Alt+Tab draw the big one.
  await api.setTaskbarIcon(Array.from(rgba), WINDOW_ICON_SIZE);
}
