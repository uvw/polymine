/** Shows the theme's icon on the window: the title bar, taskbar, and Alt+Tab. */

import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { iconColors, iconPixels, iconSvg } from "./themes/icon";
import type { Theme } from "./themes/types";

/** Big enough for the taskbar at 200% scaling, which wants 64 pixels. */
export const WINDOW_ICON_SIZE = 64;

/**
 * Sets the window's icon to `theme`'s, unless `current` says a newer request
 * replaced this one while the icon was drawn. macOS has no window icon, so
 * Tauri ignores it there.
 */
export async function applyWindowIcon(theme: Theme, current = () => true): Promise<void> {
  const rgba = await iconPixels(iconSvg(iconColors(theme)), WINDOW_ICON_SIZE);
  if (!rgba || !current()) return;
  const image = await Image.new(rgba, WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
  try {
    await getCurrentWindow().setIcon(image);
  } finally {
    await image.close();
  }
}
