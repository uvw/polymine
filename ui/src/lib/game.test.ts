import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameOver, result, settings, snapshot } from "../test/fixtures";
import type { CellChange } from "./bindings";
import type { ExternalChange } from "./bindings";
import type { ThemeList } from "./bindings";
import type { BoardView } from "./board/BoardView";

const api = vi.hoisted(() => ({
  environment: vi.fn(),
  snapshot: vi.fn(),
  newGame: vi.fn(),
  primary: vi.fn(),
  secondary: vi.fn(),
  hint: vi.fn(),
  assist: vi.fn(),
  setPaused: vi.fn(),
  getSettings: vi.fn(),
  tilingPreviews: vi.fn(() => Promise.resolve([])),
  onExternalChange: vi.fn<(handler: (change: ExternalChange) => void) => Promise<() => void>>(() =>
    Promise.resolve(() => {}),
  ),
  updateSettings: vi.fn(),
  getStats: vi.fn(),
  fitBoard: vi.fn(() => Promise.resolve({ cols: 40, rows: 20 })),
  saveAs: vi.fn(() => Promise.resolve({})),
  loadSave: vi.fn(),
  listThemes: vi.fn((): Promise<ThemeList> =>
    Promise.resolve({ folder: null, themes: [], skipped: [] }),
  ),
  readTheme: vi.fn(),
  openThemesFolder: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./api", () => ({ api, hasShell: () => true }));

const { CALL_TIMEOUT_MS, GameStore, describeGameOver } = await import("./game.svelte");

function fakeBoard() {
  return {
    load: vi.fn(),
    apply: vi.fn(),
    setLocked: vi.fn(),
    showHint: vi.fn(),
    setFocus: vi.fn(),
    anchorOf: vi.fn((cell: number) => ({ x: cell * 10, y: 100, radius: 5 })),
  };
}

/** Lets queued backend calls and their follow-ups settle. */
const flush = () => vi.advanceTimersByTimeAsync(0);

let store: InstanceType<typeof GameStore>;
let external: ((change: ExternalChange) => void) | null = null;
const unlisten = vi.fn();
let board: ReturnType<typeof fakeBoard>;

beforeEach(async () => {
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getSettings.mockResolvedValue(settings());
  api.snapshot.mockResolvedValue(snapshot());
  api.tilingPreviews.mockResolvedValue([]);
  api.onExternalChange.mockImplementation((handler: (change: ExternalChange) => void) => {
    external = handler;
    return Promise.resolve(unlisten);
  });
  store = new GameStore();
  board = fakeBoard();
  await store.init();
  store.attachBoard(board as unknown as BoardView);
});

afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

describe("changes from outside the window", () => {
  it("animates moves and reloads new games, then stops listening", async () => {
    const changes: CellChange[] = [{ cell: 4, view: { kind: "open", adjacent: 1 }, wave: 0 }];
    external?.({ kind: "action", result: result(changes) });
    await flush();
    expect(board.apply).toHaveBeenCalledWith(changes, "playing");
    api.snapshot.mockResolvedValue(snapshot(4, 4));
    const fromCli = settings({ tiling: "hexagon", level: "amateur" });
    api.getSettings.mockResolvedValue(fromCli);
    external?.({ kind: "reload" });
    await flush();
    expect(store.snapshot?.config.cols).toBe(4);
    // The CLI saved its tiling and level; a stale copy would undo them on the next save.
    expect(store.settings).toEqual(fromCli);
    store.dispose();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("updates that arrive late", () => {
  const open = (cell: number): CellChange[] => [
    { cell, view: { kind: "open", adjacent: 1 }, wave: 0 },
  ];

  it("drops an outside move older than one shown and reloads the board instead", async () => {
    const late = result(open(1));
    const fresh = result(open(2));
    api.primary.mockResolvedValue(fresh);
    await store.primary(2);
    const current = snapshot(3, 3, { revision: fresh.revision, status: "playing" });
    api.snapshot.mockResolvedValue(current);
    board.apply.mockClear();
    external?.({ kind: "action", result: late });
    await flush();
    expect(board.apply).not.toHaveBeenCalled();
    expect(board.load).toHaveBeenLastCalledWith(current);
  });

  it("keeps the shown game when a reload brings an older snapshot", async () => {
    const stale = snapshot(5, 5);
    api.primary.mockResolvedValue(result(open(2)));
    await store.primary(2);
    api.snapshot.mockResolvedValue(stale);
    external?.({ kind: "reload" });
    await flush();
    expect(store.snapshot?.config.cols).toBe(3);
  });

  it("keeps a finished game's result through the reload", async () => {
    const late = result(open(1));
    const over = gameOver("won");
    api.primary.mockResolvedValue(result(open(2), "won", { gameOver: over }));
    await store.primary(2);
    api.snapshot.mockResolvedValue(snapshot(3, 3, { status: "won" }));
    external?.({ kind: "action", result: late });
    await flush();
    expect(store.gameOver).toEqual(over);
  });
});

describe("the clock during outside play", () => {
  it("runs from the elapsed time an outside move reports", async () => {
    external?.({ kind: "action", result: result([], "playing", { elapsedMs: 1500 }) });
    await flush();
    expect(store.elapsedSeconds).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.elapsedSeconds).toBe(2);
  });
});

describe("loading", () => {
  it("loads settings and the current game, and hands the board its snapshot", () => {
    expect(store.snapshot?.config.cols).toBe(3);
    expect(store.settings?.playerName).toBe("ann");
    expect(board.load).toHaveBeenCalledWith(store.snapshot);
    expect(store.tiling).toBe("square");
    expect(store.level).toBe("beginner");
  });

  it("tints the theme with the accent color unless the setting is off", () => {
    store.settings = settings({ theme: "graphite" });
    const plain = store.theme.board.closedHover;
    store.accent = 0xff0000;
    expect(store.theme.board.closedHover).not.toBe(plain);
    store.settings = settings({ theme: "graphite", accentTint: false });
    expect(store.theme.board.closedHover).toBe(plain);
  });

  it("passes the theme through the color filter", () => {
    store.settings = settings({ theme: "midnight" });
    const plain = store.theme;
    expect(plain.board.filter).toBeNull();
    store.settings = settings({ theme: "midnight", colorFilter: "deuteranopia" });
    expect(store.theme.board.filter).toBe("deuteranopia");
    expect(store.theme.board.numbers).not.toEqual(plain.board.numbers);
    store.settings = settings({ theme: "midnight", colorFilter: "off" });
    expect(store.theme).toBe(plain);
  });

  it("derives the theme from settings, with a fallback", () => {
    expect(store.theme.id).toBe("graphite");
    store.settings = settings({ theme: "midnight" });
    expect(store.theme.id).toBe("midnight");
    store.settings = settings({ theme: "gone" });
    expect(store.theme.id).toBe("frost");
  });

  it("loads player themes at startup, with the chosen one's glyphs", async () => {
    const css = "/* Name: Dusk\n Author: A\n Description: D\n Version: 1\n Format: 1 */ :root {}";
    api.listThemes.mockResolvedValue({
      folder: "/themes",
      themes: [{ id: "dusk", css, preview: null, glyphs: ["flag"] }],
      skipped: [],
    });
    api.readTheme.mockResolvedValue({
      id: "dusk",
      css,
      preview: null,
      glyphs: [{ name: "flag", svg: "<svg/>" }],
    });
    api.getSettings.mockResolvedValue(settings({ theme: "dusk" }));
    store.dispose();
    store = new GameStore();
    await store.init();
    expect(store.themes.at(-1)?.id).toBe("dusk");
    expect(store.theme.id).toBe("dusk");
    expect(store.theme.board.glyphs.flag?.src).toMatch(/^data:image\/svg\+xml/);
  });

  it("shows a theme picked from outside, with the folder read again", async () => {
    const css = "/* Name: Dusk\n Author: A\n Description: D\n Version: 1\n Format: 1 */ :root {}";
    api.listThemes.mockResolvedValue({
      folder: "/themes",
      themes: [{ id: "dusk", css, preview: null, glyphs: ["flag"] }],
      skipped: [],
    });
    api.readTheme.mockResolvedValue({
      id: "dusk",
      css,
      preview: null,
      glyphs: [{ name: "flag", svg: "<svg/>" }],
    });
    api.getSettings.mockResolvedValue(settings({ theme: "dusk" }));
    external?.({ kind: "themes" });
    await flush();
    expect(store.theme.id).toBe("dusk");
    expect(store.theme.board.glyphs.flag?.src).toMatch(/^data:image\/svg\+xml/);
  });

  it("reads the themes folder again when asked, and opens it", async () => {
    const calls = api.listThemes.mock.calls.length;
    await store.reloadThemes();
    expect(api.listThemes).toHaveBeenCalledTimes(calls + 1);
    api.openThemesFolder.mockRejectedValue("no file manager");
    await store.openThemesFolder();
    expect(store.error).toContain("no file manager");
  });

  it("starts a new game with the same tiling and level by default", async () => {
    api.newGame.mockResolvedValue(snapshot(4, 4));
    await store.newGame();
    expect(api.newGame).toHaveBeenCalledWith({ tiling: "square", level: "beginner", custom: null });
    expect(store.snapshot?.config.cols).toBe(4);
    expect(board.load).toHaveBeenLastCalledWith(store.snapshot);
  });

  describe("a new theme each game", () => {
    const start = async (over: Parameters<typeof settings>[0]) => {
      api.newGame.mockResolvedValue(snapshot());
      api.getSettings.mockResolvedValue(settings({ theme: "loop", ...over }));
      api.updateSettings.mockImplementation((next) => Promise.resolve(next));
      await store.newGame();
      return store.settings?.theme;
    };

    it("switches to another theme from every theme", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(await start({ themeRotation: "all" })).not.toBe("loop");
      expect(api.updateSettings).toHaveBeenCalled();
    });

    it("switches between two or more favorites", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(await start({ themeRotation: "favorites", favoriteThemes: ["loop", "facet"] })).toBe(
        "facet",
      );
    });

    it("keeps the theme while rotation is off", async () => {
      expect(await start({ themeRotation: "off" })).toBe("loop");
      expect(api.updateSettings).not.toHaveBeenCalled();
    });
  });

  it("sizes a board to fill the window, keeping the mine density", async () => {
    expect(await store.fillSize("square", 0.2)).toBeNull();
    store.boardArea = { width: 1000, height: 532 };
    expect(await store.fillSize("square", 0.2)).toEqual({ cols: 40, rows: 20, mines: 160 });
    expect(api.fitBoard).toHaveBeenLastCalledWith("square", 992, 524, 12);
    expect((await store.fillSize("square", 5))?.mines).toBe(799);
  });

  it("fills the window with new custom games when the setting is on", async () => {
    api.newGame.mockResolvedValue(snapshot());
    store.settings = settings({ fillWindow: true });
    store.boardArea = { width: 1000, height: 532 };
    await store.newGame("square", "custom");
    // The saved 16 by 16 board with 40 mines sets the density.
    expect(api.newGame).toHaveBeenLastCalledWith({
      tiling: "square",
      level: "custom",
      custom: { cols: 40, rows: 20, mines: 125 },
    });
  });

  describe("with fill window on", () => {
    const fitted = { cols: 5, rows: 4 };
    const custom = { ...snapshot().config, level: "custom" as const };

    beforeEach(async () => {
      store.settings = settings({ fillWindow: true });
      api.getSettings.mockResolvedValue(store.settings);
      api.newGame.mockResolvedValue(snapshot(3, 3, { config: { ...custom, cols: 3, rows: 3 } }));
      store.boardArea = { width: 1000, height: 532 };
      api.fitBoard.mockResolvedValue({ cols: 3, rows: 3 });
      await store.newGame("square", "custom");
      api.newGame.mockClear();
    });

    it("refills an untouched custom game once the window stops changing size", async () => {
      api.fitBoard.mockResolvedValue(fitted);
      api.newGame.mockResolvedValue(snapshot(5, 4, { config: { ...custom, ...fitted } }));
      store.boardLayoutChanged();
      await vi.advanceTimersByTimeAsync(400);
      expect(api.newGame).toHaveBeenCalledWith(
        expect.objectContaining({ level: "custom", custom: expect.objectContaining(fitted) }),
      );
    });

    it("keeps the theme when a resize refills the board, rotation or not", async () => {
      api.getSettings.mockResolvedValue(settings({ fillWindow: true, themeRotation: "all" }));
      api.updateSettings.mockClear();
      api.fitBoard.mockResolvedValue(fitted);
      api.newGame.mockResolvedValue(snapshot(5, 4, { config: { ...custom, ...fitted } }));
      store.boardLayoutChanged();
      await vi.advanceTimersByTimeAsync(400);
      expect(api.newGame).toHaveBeenCalled();
      expect(api.updateSettings).not.toHaveBeenCalled();
    });

    it("keeps a game the player started while the new size was worked out", async () => {
      let fit!: (size: { cols: number; rows: number }) => void;
      api.fitBoard.mockReturnValue(new Promise((resolve) => (fit = resolve)));
      let click!: (r: ReturnType<typeof result>) => void;
      api.primary.mockReturnValue(new Promise((resolve) => (click = resolve)));
      store.boardLayoutChanged();
      await vi.advanceTimersByTimeAsync(400);
      const clicked = store.primary(0);
      fit(fitted);
      await flush();
      click(result([{ cell: 0, view: { kind: "open", adjacent: 1 }, wave: 0 }]));
      await clicked;
      await flush();
      expect(store.status).toBe("playing");
      expect(api.newGame).not.toHaveBeenCalled();
    });
  });

  it("saves the game in play and loads a save in its place", async () => {
    await store.saveAs("corner");
    expect(api.saveAs).toHaveBeenCalledWith("corner");
    api.loadSave.mockResolvedValue(snapshot(4, 4));
    await store.loadSave("corner");
    expect(api.loadSave).toHaveBeenCalledWith("corner");
    expect(store.snapshot?.config.cols).toBe(4);
  });

  it("passes the saved custom size for custom levels", async () => {
    api.newGame.mockResolvedValue(snapshot());
    await store.newGame("hexagon", "custom");
    expect(api.newGame).toHaveBeenCalledWith({
      tiling: "hexagon",
      level: "custom",
      custom: { cols: 16, rows: 16, mines: 40 },
    });
  });
});

describe("playing", () => {
  it("applies changes to the board and updates counters", async () => {
    const changes = [{ cell: 4, view: { kind: "open" as const, adjacent: 1 }, wave: 0 }];
    api.primary.mockResolvedValue(result(changes));
    await store.primary(4);
    expect(board.apply).toHaveBeenCalledWith(changes, "playing");
    expect(store.status).toBe("playing");
    expect(store.counters.opened).toBe(1);
  });

  it("leaves the board alone when an action changes nothing", async () => {
    api.secondary.mockResolvedValue(result([]));
    await store.secondary(0);
    expect(board.apply).not.toHaveBeenCalled();
  });

  it("records a finished game and announces it", async () => {
    const over = gameOver("won");
    api.primary.mockResolvedValue(result([], "won", { gameOver: over }));
    await store.primary(0);
    await flush();
    expect(store.gameOver).toEqual(over);
    expect(store.announcement).toBe("Cleared in 12.35 s");
  });

  it("runs backend calls in order, even when they resolve out of order", async () => {
    const order: string[] = [];
    api.primary.mockImplementation(
      () => new Promise((r) => setTimeout(() => (order.push("primary"), r(result([]))), 50)),
    );
    api.secondary.mockImplementation(async () => (order.push("secondary"), result([])));
    void store.primary(0);
    void store.secondary(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(order).toEqual(["primary", "secondary"]);
  });

  it("gives up on a call that never answers and runs the next one", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    api.primary.mockReturnValueOnce(new Promise(() => {}));
    api.secondary.mockResolvedValue(
      result([{ cell: 1, view: { kind: "closed", mark: "flag" }, wave: 0 }]),
    );
    const stuck = store.primary(0);
    const next = store.secondary(1);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(api.secondary).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await stuck).toBeUndefined();
    expect(store.error).toBe(
      "Something went wrong: Polymine stopped waiting after 60 seconds without an answer.",
    );
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("unanswered"));
    await next;
    expect(api.secondary).toHaveBeenCalledWith(1);
    expect(board.apply).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("shows backend errors and clears them later", async () => {
    api.primary.mockRejectedValue("disk full");
    await store.primary(0);
    expect(store.error).toBe("Something went wrong: disk full");
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.error).toBeNull();
  });
});

describe("clock", () => {
  it("ticks in whole seconds while playing and stops at the end", async () => {
    api.primary.mockResolvedValue(result([], "playing", { elapsedMs: 0 }));
    await store.primary(0);
    await vi.advanceTimersByTimeAsync(2600);
    expect(store.elapsedSeconds).toBe(2);
    api.primary.mockResolvedValue(result([], "won", { elapsedMs: 4200 }));
    await store.primary(1);
    expect(store.elapsedSeconds).toBe(4);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.elapsedSeconds).toBe(4);
  });

  it("pauses and resumes through the backend, locking the board", async () => {
    api.primary.mockResolvedValue(result([], "playing"));
    await store.primary(0);
    api.setPaused.mockResolvedValue(
      snapshot(3, 3, { status: "playing", paused: true, elapsedMs: 3000 }),
    );
    await store.togglePause();
    expect(store.paused).toBe(true);
    expect(board.setLocked).toHaveBeenLastCalledWith(true);
    api.setPaused.mockResolvedValue(
      snapshot(3, 3, { status: "playing", paused: false, elapsedMs: 3000 }),
    );
    await store.togglePause();
    expect(store.paused).toBe(false);
  });

  it("ignores pause before the game starts", async () => {
    await store.togglePause();
    expect(api.setPaused).not.toHaveBeenCalled();
  });
});

describe("hints", () => {
  it("pins a hint label to the cell and announces it", async () => {
    api.hint.mockResolvedValue({
      action: "open",
      cell: 2,
      certain: true,
      mineProbability: 0,
      exact: true,
    });
    await store.showHint();
    await flush();
    expect(board.showHint).toHaveBeenCalledWith(2, "open");
    expect(store.hint).toEqual({
      cell: 2,
      text: "Safe to open",
      anchor: { x: 20, y: 100, radius: 5 },
    });
    expect(store.assisted).toBe(true);
    expect(store.announcement).toBe("Row 1, column 3: Safe to open");
  });

  it("says where the hint is, for asked and idle hints alike", async () => {
    api.hint.mockResolvedValue({
      action: "flag",
      cell: 7,
      certain: true,
      mineProbability: 1,
      exact: true,
    });
    await store.showHint();
    await flush();
    expect(store.announcement).toBe("Row 3, column 2: Certain mine");

    store.settings = settings({
      assistant: { ...settings().assistant, idleAction: "hint", idleSeconds: 5 },
    });
    store.hint = null;
    store.status = "playing";
    api.hint.mockResolvedValue({
      action: "open",
      cell: 3,
      certain: true,
      mineProbability: 0,
      exact: true,
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.announcement).toBe("Row 2, column 1: Safe to open");
  });

  it("describes guesses, flags and wrong flags", async () => {
    const texts: string[] = [];
    for (const s of [
      { action: "open", cell: 0, certain: false, mineProbability: 0.25, exact: true },
      { action: "open", cell: 0, certain: false, mineProbability: 0.234, exact: false },
      { action: "flag", cell: 0, certain: true, mineProbability: 1, exact: true },
      { action: "unflag", cell: 0, certain: true, mineProbability: 0, exact: true },
    ]) {
      api.hint.mockResolvedValue(s);
      await store.showHint();
      texts.push(store.hint?.text ?? "");
    }
    expect(texts).toEqual([
      "No safe move. Best guess: 25% mine risk",
      "No safe move. Best guess: about 23% mine risk",
      "Certain mine",
      "This flag is wrong",
    ]);
  });

  it("announces estimated odds as an estimate", async () => {
    api.hint.mockResolvedValue({
      action: "open",
      cell: 4,
      certain: false,
      mineProbability: 0.4,
      exact: false,
    });
    await store.showHint();
    await flush();
    expect(store.announcement).toBe(
      "Row 2, column 2: No safe move. Best guess: about 40% mine risk",
    );
  });

  it("follows the board when it moves and clears on the next change", async () => {
    api.hint.mockResolvedValue({
      action: "open",
      cell: 1,
      certain: true,
      mineProbability: 0,
      exact: true,
    });
    await store.showHint();
    board.anchorOf.mockReturnValue({ x: 1, y: 2, radius: 3 });
    store.boardLayoutChanged();
    expect(store.hint?.anchor).toEqual({ x: 1, y: 2, radius: 3 });
    api.primary.mockResolvedValue(
      result([{ cell: 1, view: { kind: "open", adjacent: 0 }, wave: 0 }]),
    );
    await store.primary(1);
    expect(store.hint).toBeNull();
  });

  it("does nothing when the assistant has no move", async () => {
    api.hint.mockResolvedValue(null);
    await store.showHint();
    expect(store.hint).toBeNull();
    expect(store.assisted).toBe(false);
  });

  it("shows a hint after the configured idle time", async () => {
    store.settings = settings({
      assistant: { ...settings().assistant, idleAction: "hint", idleSeconds: 5 },
    });
    api.primary.mockResolvedValue(result([], "playing"));
    await store.primary(0);
    api.hint.mockResolvedValue({
      action: "open",
      cell: 3,
      certain: true,
      mineProbability: 0,
      exact: true,
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.hint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.hint).toHaveBeenCalledTimes(1);
  });
});

describe("autoplay", () => {
  const move = (cell: number) => ({
    suggestion: { action: "open", cell, certain: true, mineProbability: 0, exact: true },
    result: result([{ cell, view: { kind: "open", adjacent: 0 }, wave: 0 }]),
  });

  it("plays moves until the game ends", async () => {
    api.assist
      .mockResolvedValueOnce(move(0))
      .mockResolvedValueOnce({
        ...move(1),
        result: result([], "won", { gameOver: gameOver("won") }),
      })
      .mockResolvedValue(null);
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(100);
    expect(api.assist).toHaveBeenCalledWith(true);
    expect(store.status).toBe("won");
    expect(store.autoplay).toBe(false);
  });

  it("stops at a guess when told to, and pins the suggested cell", async () => {
    store.settings = settings({ assistant: { ...settings().assistant, stopWhenUncertain: true } });
    api.assist.mockResolvedValue({
      suggestion: { action: "open", cell: 5, certain: false, mineProbability: 0.3, exact: true },
      result: null,
    });
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(50);
    expect(api.assist).toHaveBeenCalledWith(false);
    expect(store.autoplay).toBe(false);
    expect(store.hint?.text).toBe("Bot stopped: only guesses are left");
  });

  it("starts the next game by itself when asked", async () => {
    store.settings = settings({ assistant: { ...settings().assistant, autostartNextGame: true } });
    store.status = "lost";
    api.newGame.mockResolvedValue(snapshot());
    api.getSettings.mockResolvedValue(store.settings);
    api.assist.mockResolvedValue(null);
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.newGame).toHaveBeenCalled();
  });

  it("keeps one loop when switched off and on within a move delay", async () => {
    store.settings = settings({ assistant: { ...settings().assistant, moveDelayMs: 1000 } });
    api.assist.mockResolvedValue(move(0));
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(10);
    store.toggleAutoplay();
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(10);
    api.assist.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    // One loop at 1,000 ms per move makes about three moves in three seconds.
    expect(api.assist.mock.calls.length).toBeLessThanOrEqual(3);
    expect(store.autoplay).toBe(true);
    store.toggleAutoplay();
  });

  it("can be switched off mid-game", async () => {
    api.assist.mockResolvedValue(move(0));
    store.toggleAutoplay();
    await vi.advanceTimersByTimeAsync(5);
    store.toggleAutoplay();
    const calls = api.assist.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(api.assist.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    expect(store.autoplay).toBe(false);
  });
});

describe("FastMines field behavior", () => {
  const over = async (status: "won" | "lost") => {
    api.primary.mockResolvedValue(result([], status, { gameOver: gameOver(status) }));
    await store.primary(0);
  };

  it("starts a new game on a right click after the game ends", async () => {
    await over("lost");
    api.newGame.mockResolvedValue(snapshot());
    await store.secondary(3);
    expect(api.secondary).not.toHaveBeenCalled();
    expect(api.newGame).toHaveBeenCalledWith({ tiling: "square", level: "beginner", custom: null });
  });

  it("does the same for right clicks between cells", async () => {
    await over("won");
    api.newGame.mockResolvedValue(snapshot());
    await store.fieldSecondary();
    expect(api.newGame).toHaveBeenCalled();
  });

  it("ignores a right click between cells during play", async () => {
    await store.fieldSecondary();
    expect(api.newGame).not.toHaveBeenCalled();
    expect(api.setPaused).not.toHaveBeenCalled();
  });

  it("resumes a paused game on a right click and on New Game", async () => {
    api.primary.mockResolvedValue(result([], "playing"));
    await store.primary(0);
    api.setPaused.mockResolvedValue(snapshot(3, 3, { status: "playing", paused: true }));
    await store.togglePause();
    api.setPaused.mockResolvedValue(snapshot(3, 3, { status: "playing", paused: false }));
    await store.fieldSecondary();
    expect(store.paused).toBe(false);

    api.setPaused.mockResolvedValue(snapshot(3, 3, { status: "playing", paused: true }));
    await store.togglePause();
    api.setPaused.mockResolvedValue(snapshot(3, 3, { status: "playing", paused: false }));
    await store.newGame();
    expect(store.paused).toBe(false);
    expect(api.newGame).not.toHaveBeenCalled();
  });

  it("still switches games from a paused one when a tiling is picked", async () => {
    store.paused = true;
    api.newGame.mockResolvedValue(snapshot());
    await store.newGame("cairo");
    expect(api.newGame).toHaveBeenCalledWith({ tiling: "cairo", level: "beginner", custom: null });
  });

  it("pauses only a game in play, and never during autoplay", async () => {
    await store.pauseIfPlaying();
    expect(api.setPaused).not.toHaveBeenCalled();
    api.primary.mockResolvedValue(result([], "playing"));
    await store.primary(0);
    store.autoplay = true;
    await store.pauseIfPlaying();
    expect(api.setPaused).not.toHaveBeenCalled();
    store.autoplay = false;
    api.setPaused.mockResolvedValue(snapshot(3, 3, { status: "playing", paused: true }));
    await store.pauseIfPlaying();
    expect(store.paused).toBe(true);
  });

  it("stops autoplay when the player clicks", async () => {
    store.autoplay = true;
    api.primary.mockResolvedValue(result([]));
    await store.primary(0);
    expect(store.autoplay).toBe(false);
  });

  it("lets the assistant take over after the idle time", async () => {
    store.settings = settings({
      assistant: { ...settings().assistant, idleAction: "autoplay", idleSeconds: 5 },
    });
    api.assist.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.assist).toHaveBeenCalled();
  });

  it("passes zoom steps to the board", () => {
    const setZoom = vi.fn();
    store.attachBoard({ ...board, setZoom } as unknown as BoardView);
    store.zoom("in");
    expect(setZoom).toHaveBeenCalledWith("in");
  });
});

describe("keyboard focus", () => {
  it("starts in the middle and announces the cell", async () => {
    store.focusBoard();
    await flush();
    expect(store.focusedCell).toBe(4);
    expect(board.setFocus).toHaveBeenCalledWith(4);
    expect(store.announcement).toBe("Row 2, column 2: closed");
  });

  it("moves with arrows and stops at the edge", () => {
    store.focusBoard();
    store.moveFocus("right");
    expect(store.focusedCell).toBe(5);
    store.moveFocus("right");
    expect(store.focusedCell).toBe(5);
    store.moveFocus("up");
    expect(store.focusedCell).toBe(2);
  });

  it("opens and flags the focused cell", async () => {
    api.primary.mockResolvedValue(
      result([{ cell: 4, view: { kind: "open", adjacent: 3 }, wave: 0 }]),
    );
    api.secondary.mockResolvedValue(result([]));
    store.focusBoard();
    store.openFocused();
    await flush();
    expect(api.primary).toHaveBeenCalledWith(4);
    expect(store.announcement).toBe("Row 2, column 2: 3 mines nearby");
    store.flagFocused();
    await flush();
    expect(api.secondary).toHaveBeenCalledWith(4);
  });

  it("does nothing without a focused cell", () => {
    store.moveFocus("left");
    store.openFocused();
    store.flagFocused();
    expect(api.primary).not.toHaveBeenCalled();
    expect(api.secondary).not.toHaveBeenCalled();
  });

  it("hides the ring on a pointer press, and picks up at the pressed cell", async () => {
    store.focusBoard();
    store.moveFocus("right");
    vi.mocked(board.setFocus).mockClear();
    store.pointerPress(0);
    expect(store.focusedCell).toBeNull();
    expect(board.setFocus).toHaveBeenCalledWith(null);
    store.focusBoard();
    await flush();
    expect(store.focusedCell).toBe(0);
    expect(store.announcement).toBe("Row 1, column 1: closed");
    store.moveFocus("right");
    expect(store.focusedCell).toBe(1);
  });

  it("starts in the middle after a press off every cell", () => {
    store.focusBoard();
    store.moveFocus("left");
    store.pointerPress(null);
    store.focusBoard();
    expect(store.focusedCell).toBe(4);
  });

  it("leaves the ring alone on a press when it's already hidden", () => {
    store.pointerPress(2);
    expect(board.setFocus).not.toHaveBeenCalled();
  });

  it("hides the ring on blur", () => {
    store.blurBoard();
    expect(board.setFocus).toHaveBeenCalledWith(null);
  });
});

describe("disposal", () => {
  it("leaves no timers behind, even an error's", async () => {
    api.primary.mockRejectedValue("disk full");
    await store.primary(0);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops cleanly when disposed during startup", async () => {
    store.dispose();
    let listen!: (stop: () => void) => void;
    api.onExternalChange.mockReturnValue(new Promise((resolve) => (listen = resolve)));
    const late = new GameStore();
    const starting = late.init();
    await flush();
    late.dispose();
    const stop = vi.fn();
    listen(stop);
    await starting;
    expect(stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("settings", () => {
  it("saves through the backend", async () => {
    const next = settings({ playerName: "bob" });
    api.updateSettings.mockResolvedValue(next);
    await store.updateSettings(next);
    expect(store.settings?.playerName).toBe("bob");
  });
});

describe("describeGameOver", () => {
  it("phrases wins and losses", () => {
    expect(describeGameOver(gameOver("won"))).toBe("Cleared in 12.35 s");
    expect(describeGameOver(gameOver("lost"))).toBe("Lost with 43% cleared");
  });
});
