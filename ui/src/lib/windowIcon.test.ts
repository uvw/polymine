import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBuiltIns } from "./themes/builtin";
import { resolveTheme } from "./themes/resolve";
import type { ThemeEntry } from "./themes/types";

const setIcon = vi.fn();
const close = vi.fn();
const imageNew = vi.fn();
const pixels = vi.fn();
const setTaskbarIcon = vi.fn();
const setDockIcon = vi.fn();
const png = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setIcon }) }));
vi.mock("@tauri-apps/api/image", () => ({ Image: { new: imageNew } }));
vi.mock("./api", () => ({ api: { setTaskbarIcon, setDockIcon } }));
vi.mock("./themes/icon", async (original) => ({
  ...(await original<typeof import("./themes/icon")>()),
  iconPixels: pixels,
  iconPng: png,
}));

const { applyWindowIcon, DOCK_ICON_SIZE, WINDOW_ICON_SIZE } = await import("./windowIcon");
const theme = resolveTheme(loadBuiltIns()[0] as ThemeEntry, { accent: null, dark: true });

beforeEach(() => {
  vi.clearAllMocks();
  imageNew.mockResolvedValue({ close });
});

describe("applyWindowIcon", () => {
  it("sets the theme's icon on the window and frees the image", async () => {
    const rgba = new Uint8Array(4);
    pixels.mockResolvedValue(rgba);
    await applyWindowIcon(theme, "windows");
    expect(pixels).toHaveBeenCalledWith(expect.stringContaining("<svg"), WINDOW_ICON_SIZE);
    expect(imageNew).toHaveBeenCalledWith(rgba, WINDOW_ICON_SIZE, WINDOW_ICON_SIZE);
    expect(setIcon).toHaveBeenCalledWith({ close });
    expect(close).toHaveBeenCalled();
  });

  it("gives the taskbar the same icon, which Tauri's own call leaves out", async () => {
    const rgba = new Uint8Array([1, 2, 3, 4]);
    pixels.mockResolvedValue(rgba);
    await applyWindowIcon(theme, "windows");
    expect(setTaskbarIcon).toHaveBeenCalledWith([1, 2, 3, 4], WINDOW_ICON_SIZE);
  });

  it("frees the image when the window refuses it", async () => {
    pixels.mockResolvedValue(new Uint8Array(4));
    setIcon.mockRejectedValueOnce(new Error("no"));
    await expect(applyWindowIcon(theme, "windows")).rejects.toThrow("no");
    expect(close).toHaveBeenCalled();
  });

  it("drops the icon when a newer request replaced it while it was drawn", async () => {
    pixels.mockResolvedValue(new Uint8Array(4));
    await applyWindowIcon(theme, "windows", () => false);
    expect(imageNew).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(setTaskbarIcon).not.toHaveBeenCalled();
  });

  it("leaves the icon alone without a canvas", async () => {
    pixels.mockResolvedValue(null);
    await applyWindowIcon(theme, "windows");
    expect(imageNew).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });

  it("gives macOS the theme's icon in the Dock, and no window icon", async () => {
    png.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    await applyWindowIcon(theme, "macos");
    expect(png).toHaveBeenCalledWith(expect.stringContaining("<svg"), DOCK_ICON_SIZE);
    expect(setDockIcon).toHaveBeenCalledWith([137, 80, 78, 71]);
    expect(pixels).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(setTaskbarIcon).not.toHaveBeenCalled();
  });

  it("draws the Dock's icon from the same picture as the window's", async () => {
    png.mockResolvedValue(new Uint8Array(4));
    pixels.mockResolvedValue(new Uint8Array(4));
    await applyWindowIcon(theme, "macos");
    await applyWindowIcon(theme, "windows");
    expect(png.mock.calls[0]?.[0]).toBe(pixels.mock.calls[0]?.[0]);
  });

  it("drops the Dock's icon when a newer request replaced it", async () => {
    png.mockResolvedValue(new Uint8Array(4));
    await applyWindowIcon(theme, "macos", () => false);
    expect(setDockIcon).not.toHaveBeenCalled();
  });

  it("leaves the Dock alone without a canvas", async () => {
    png.mockResolvedValue(null);
    await applyWindowIcon(theme, "macos");
    expect(setDockIcon).not.toHaveBeenCalled();
  });
});
