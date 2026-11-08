import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBuiltIns } from "./themes/builtin";
import { resolveTheme } from "./themes/resolve";
import type { ThemeEntry } from "./themes/types";

const setIcon = vi.fn();
const close = vi.fn();
const imageNew = vi.fn();
const pixels = vi.fn();
const setTaskbarIcon = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setIcon }) }));
vi.mock("@tauri-apps/api/image", () => ({ Image: { new: imageNew } }));
vi.mock("./api", () => ({ api: { setTaskbarIcon } }));
vi.mock("./themes/icon", async (original) => ({
  ...(await original<typeof import("./themes/icon")>()),
  iconPixels: pixels,
}));

const { applyWindowIcon, WINDOW_ICON_SIZE } = await import("./windowIcon");
const theme = resolveTheme(loadBuiltIns()[0] as ThemeEntry, { accent: null, dark: true });

beforeEach(() => {
  vi.clearAllMocks();
  imageNew.mockResolvedValue({ close });
});

describe("applyWindowIcon", () => {
  it("sets the theme's icon on the window and frees the image", async () => {
    const rgba = new Uint8Array(4);
    pixels.mockResolvedValue(rgba);
    await applyWindowIcon(theme);
    expect(pixels).toHaveBeenCalledWith(expect.stringContaining("<svg"), WINDOW_ICON_SIZE);
    expect(imageNew).toHaveBeenCalledWith(rgba, WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
    expect(setIcon).toHaveBeenCalledWith({ close });
    expect(close).toHaveBeenCalled();
  });

  it("gives the taskbar the same icon, which Tauri's own call leaves out", async () => {
    const rgba = new Uint8Array([1, 2, 3, 4]);
    pixels.mockResolvedValue(rgba);
    await applyWindowIcon(theme);
    expect(setTaskbarIcon).toHaveBeenCalledWith([1, 2, 3, 4], WINDOW_ICON_SIZE);
  });

  it("frees the image when the window refuses it", async () => {
    pixels.mockResolvedValue(new Uint8Array(4));
    setIcon.mockRejectedValueOnce(new Error("no"));
    await expect(applyWindowIcon(theme)).rejects.toThrow("no");
    expect(close).toHaveBeenCalled();
  });

  it("drops the icon when a newer request replaced it while it was drawn", async () => {
    pixels.mockResolvedValue(new Uint8Array(4));
    await applyWindowIcon(theme, () => false);
    expect(imageNew).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(setTaskbarIcon).not.toHaveBeenCalled();
  });

  it("leaves the icon alone without a canvas", async () => {
    pixels.mockResolvedValue(null);
    await applyWindowIcon(theme);
    expect(imageNew).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });
});
