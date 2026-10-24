import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const menuItems = vi.hoisted(() => [] as { kind: string; options: Record<string, unknown> }[]);
vi.mock("@tauri-apps/api/menu", () => {
  const make = (kind: string) => ({
    new: vi.fn(async (options: Record<string, unknown>) => {
      const item = { kind, options, setChecked: vi.fn(), setAsAppMenu: vi.fn() };
      menuItems.push(item);
      return item;
    }),
  });
  return {
    Menu: make("menu"),
    Submenu: make("submenu"),
    MenuItem: make("item"),
    CheckMenuItem: make("check"),
    PredefinedMenuItem: make("predefined"),
  };
});

const { api } = await import("./api");
const { describeCell } = await import("./describe");
const { applyEnvironment, platform, prefersReducedMotion, shortcut } =
  await import("./platform.svelte");
const { installMacMenu } = await import("./menu");
const { formatDate, formatPercent } = await import("./format");

beforeEach(() => {
  invoke.mockReset();
  menuItems.length = 0;
});

describe("api", () => {
  it("maps each call to its Tauri command", async () => {
    invoke.mockResolvedValue(null);
    await api.environment();
    await api.snapshot();
    await api.newGame({ tiling: "square", level: "beginner", custom: null });
    await api.primary(3);
    await api.secondary(4);
    await api.hint();
    await api.assist(true);
    await api.setPaused(true);
    await api.getSettings();
    await api.getStats("cairo", "crazy", "ann");
    expect(invoke.mock.calls).toEqual([
      ["get_environment"],
      ["snapshot"],
      ["new_game", { request: { tiling: "square", level: "beginner", custom: null } }],
      ["primary", { cell: 3 }],
      ["secondary", { cell: 4 }],
      ["hint"],
      ["assist", { allowGuess: true }],
      ["set_paused", { paused: true }],
      ["get_settings"],
      ["get_stats", { tiling: "cairo", level: "crazy", player: "ann" }],
    ]);
  });
});

describe("describeCell", () => {
  it("describes every cell state", () => {
    const at = (view: Parameters<typeof describeCell>[0]) => describeCell(view, 0, 1);
    expect(at({ kind: "closed", mark: "none" })).toBe("Row 1, column 2: closed");
    expect(at({ kind: "closed", mark: "flag" })).toMatch(/flagged$/);
    expect(at({ kind: "closed", mark: "question" })).toMatch(/question mark$/);
    expect(at({ kind: "open", adjacent: 0 })).toMatch(/empty$/);
    expect(at({ kind: "open", adjacent: 1 })).toMatch(/: one mine nearby$/);
    expect(at({ kind: "open", adjacent: 5 })).toMatch(/5 mines nearby$/);
    expect(at({ kind: "mine", exploded: false })).toMatch(/: mine$/);
    expect(at({ kind: "mine", exploded: true })).toMatch(/exploded mine$/);
    expect(at({ kind: "wrongFlag" })).toMatch(/wrong flag$/);
  });
});

describe("platform", () => {
  it("tags the document and formats shortcuts per platform", () => {
    applyEnvironment("macos", false);
    expect(platform()).toBe("macos");
    expect(document.documentElement).toHaveClass("platform-macos");
    expect(document.documentElement).not.toHaveClass("has-material");
    expect(shortcut("N", { mod: true })).toBe("⌘N");
    applyEnvironment("windows", true);
    expect(document.documentElement).not.toHaveClass("platform-macos");
    expect(shortcut("N", { mod: true })).toBe("Ctrl+N");
    expect(shortcut("H")).toBe("H");
    applyEnvironment("linux", false);
    expect(platform()).toBe("linux");
    expect(document.documentElement).toHaveClass("platform-linux");
    expect(document.documentElement).not.toHaveClass("platform-windows");
  });

  it("knows no platform until the shell reports one", async () => {
    vi.resetModules();
    const fresh = await import("./platform.svelte");
    expect(fresh.platform()).toBeNull();
  });

  it("reads the reduced-motion preference", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("format", () => {
  it("formats percentages and dates", () => {
    expect(formatPercent(42.6)).toBe("43%");
    expect(formatDate(Date.UTC(2026, 0, 15, 12))).toMatch(/2026/);
  });
});

describe("installMacMenu", () => {
  it("builds the app, game, edit, tiling, options, bot, and window menus", async () => {
    const actions = {
      newGame: vi.fn(),
      setLevel: vi.fn(),
      customLevel: vi.fn(),
      saves: vi.fn(),
      setTiling: vi.fn(),
      statistics: vi.fn(),
      toggleSmartClick: vi.fn(),
      toggleQuestionMarks: vi.fn(),
      settings: vi.fn(),
      hint: vi.fn(),
      toggleAutoplay: vi.fn(),
      togglePause: vi.fn(),
      about: vi.fn(),
    };
    const sync = await installMacMenu(actions);
    const submenus = menuItems.filter((i) => i.kind === "submenu").map((i) => i.options.text);
    expect(submenus).toEqual(["Polymine", "Game", "Edit", "Tiling", "Options", "Bot", "Window"]);
    const predefined = menuItems.filter((i) => i.kind === "predefined").map((i) => i.options.item);
    expect(predefined).toEqual(
      expect.arrayContaining(["Copy", "Paste", "SelectAll", "Quit", "Minimize"]),
    );
    const newGame = menuItems.find((i) => i.options.text === "New game");
    expect(newGame?.options.accelerator).toBe("Cmd+N");
    const shortcutOf = (text: string) =>
      menuItems.find((i) => i.options.text === text)?.options.accelerator;
    expect([
      shortcutOf("Hint"),
      shortcutOf("Let the bot play"),
      shortcutOf("Pause or resume"),
      shortcutOf("Saves…"),
    ]).toEqual(["H", "B", "P", "Cmd+S"]);
    (menuItems.find((i) => i.options.text === "Saves…")?.options.action as () => void)();
    expect(actions.saves).toHaveBeenCalled();
    (newGame?.options.action as () => void)();
    expect(actions.newGame).toHaveBeenCalled();
    (menuItems.find((i) => i.options.text === "Crazy")?.options.action as () => void)();
    expect(actions.setLevel).toHaveBeenCalledWith("crazy");
    (menuItems.find((i) => i.options.text === "Hexagons")?.options.action as () => void)();
    expect(actions.setTiling).toHaveBeenCalledWith("hexagon");

    sync({
      level: "crazy",
      tiling: "hexagon",
      smartClick: false,
      questionMarks: true,
      autoplay: true,
    });
    const checked = (text: string) =>
      (
        menuItems.find((i) => i.options.text === text) as unknown as {
          setChecked: ReturnType<typeof vi.fn>;
        }
      ).setChecked.mock.calls.at(-1)?.[0];
    expect(checked("Crazy")).toBe(true);
    expect(checked("Beginner")).toBe(false);
    expect(checked("Hexagons")).toBe(true);
    expect(checked("Smart click")).toBe(false);
    expect(checked("Let the bot play")).toBe(true);
  });
});
