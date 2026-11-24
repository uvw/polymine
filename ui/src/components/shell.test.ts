import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameOver, settings, snapshot } from "../test/fixtures";
import type { UpdateInfo } from "../lib/bindings";

const api = vi.hoisted(() => ({
  environment: vi.fn(),
  snapshot: vi.fn(),
  getSettings: vi.fn(),
  tilingPreviews: vi.fn(() => Promise.resolve([])),
  onExternalChange: vi.fn(() => Promise.resolve(() => {})),
  newGame: vi.fn(),
  hint: vi.fn(),
  getStats: vi.fn(),
  accent: vi.fn(() => Promise.resolve(0x00ff00)),
  windowInFront: vi.fn(() => Promise.resolve(false)),
  listThemes: vi.fn(() => Promise.resolve({ folder: null, themes: [], skipped: [] })),
  readTheme: vi.fn(),
  openThemesFolder: vi.fn(() => Promise.resolve(null)),
  listSaves: vi.fn(() => Promise.resolve([])),
  checkForUpdate: vi.fn((): Promise<UpdateInfo | null> => Promise.resolve(null)),
}));
const appWindow = vi.hoisted(() => ({
  focusHandler: null as ((event: { payload: boolean }) => void) | null,
  onFocusChanged: vi.fn(function (
    this: { focusHandler: unknown },
    handler: (event: { payload: boolean }) => void,
  ) {
    appWindow.focusHandler = handler;
    return Promise.resolve(() => {});
  }),
  close: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onResized: vi.fn(() => Promise.resolve(() => {})),
  listen: vi.fn(() => Promise.resolve(() => {})),
  setTitle: vi.fn(() => Promise.resolve()),
}));
const fakeBoard = vi.hoisted(() => ({
  load: vi.fn(),
  setLocked: vi.fn(),
  setTheme: vi.fn(),
  setFocus: vi.fn(),
  destroy: vi.fn(),
  anchorOf: vi.fn(() => ({ x: 50, y: 30, radius: 8 })),
}));
const installMacMenu = vi.hoisted(() => vi.fn());
const applyWindowIcon = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../lib/api", () => ({ api, hasShell: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => appWindow }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.0") }));
vi.mock("../lib/board/BoardView", () => ({
  BoardView: { create: vi.fn(() => Promise.resolve(fakeBoard)) },
}));
vi.mock("../lib/windowIcon", () => ({ applyWindowIcon }));
vi.mock("../lib/menu", async (original) => ({
  ...(await original<typeof import("../lib/menu")>()),
  installMacMenu,
}));

const { game } = await import("../lib/game.svelte");
const { applyEnvironment } = await import("../lib/platform.svelte");
const { default: TopBar } = await import("./TopBar.svelte");
const { default: Overlays, DRIFT_MS } = await import("./Overlays.svelte");
const { default: BoardCanvas } = await import("./BoardCanvas.svelte");
const { default: App } = await import("../App.svelte");
const { default: AboutDialog } = await import("./AboutDialog.svelte");

const noop = () => {};

beforeEach(() => {
  game.settings = settings();
  game.snapshot = snapshot();
  game.status = "playing";
  game.counters = { minesLeft: 7, opened: 3, safeCells: 7, clicks: 2 };
  game.elapsedSeconds = 65;
  game.gameOver = null;
  game.paused = false;
  game.autoplay = false;
  game.hint = null;
  game.error = null;
  game.focusedCell = null;
  applyEnvironment("windows", true);
});

afterEach(() => vi.restoreAllMocks());

describe("TopBar", () => {
  const props = {
    onCustomLevel: vi.fn(),
    onSaves: vi.fn(),
    onStats: vi.fn(),
    onSettings: vi.fn(),
    onAbout: vi.fn(),
  };

  it("shows mines left and the clock", () => {
    render(TopBar, { props });
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("names the figures in text screen readers reach", () => {
    render(TopBar, { props });
    for (const [label, value] of [
      ["Mines left", "7"],
      ["Time", "1:05"],
    ] as const) {
      const name = screen.getByText(label);
      expect(name).toHaveClass("sr-only");
      const figure = name.closest(".figure");
      expect(figure).not.toHaveAttribute("aria-label");
      expect(figure).toHaveTextContent(value);
    }
  });

  it("draws its own window buttons on Windows", async () => {
    const user = userEvent.setup();
    render(TopBar, { props });
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(appWindow.minimize).toHaveBeenCalled();
    expect(appWindow.toggleMaximize).toHaveBeenCalled();
    expect(appWindow.close).toHaveBeenCalled();
  });

  it("leaves window buttons and dragging to the native title bar on Linux", () => {
    applyEnvironment("linux", false);
    render(TopBar, { props });
    expect(screen.queryByRole("button", { name: "Minimize" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-tauri-drag-region]")).toBeNull();
  });

  it("follows the platform once the shell reports it", () => {
    applyEnvironment("linux", false);
    render(TopBar, { props });
    applyEnvironment("windows", false);
    flushSync();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(document.querySelector(".toolbar")).toHaveAttribute("data-tauri-drag-region");
  });

  it("marks a negative mine count", () => {
    game.counters = { ...game.counters, minesLeft: -2 };
    render(TopBar, { props });
    expect(screen.getByText("-2").closest(".figure")).toHaveClass("negative");
  });

  it("replaces the figures with the result when a game ends", () => {
    game.gameOver = { ...gameOver("won"), championRank: 2 };
    render(TopBar, { props });
    expect(screen.getByText("Cleared in 12.35 s")).toBeInTheDocument();
    expect(screen.getByText("New record: #2")).toBeInTheDocument();
  });

  it("starts the next game from the result", async () => {
    const user = userEvent.setup();
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    game.gameOver = gameOver("lost");
    render(TopBar, { props });
    const result = screen.getByRole("button", { name: /^New game Lost with 43% cleared/ });
    expect(result).toHaveAttribute("title", "New game (Ctrl+N)");
    await user.click(result);
    expect(newGame).toHaveBeenCalledWith();
  });

  it("notes when an ended game was assisted", () => {
    game.gameOver = gameOver("lost", { assisted: true });
    render(TopBar, { props });
    expect(screen.getByText("Lost with 43% cleared")).toBeInTheDocument();
    expect(screen.getByText(/not ranked/)).toBeInTheDocument();
  });

  it("wires the action buttons to the game", async () => {
    const user = userEvent.setup();
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    const hint = vi.spyOn(game, "showHint").mockResolvedValue(undefined);
    const autoplay = vi.spyOn(game, "toggleAutoplay").mockImplementation(noop);
    const pause = vi.spyOn(game, "togglePause").mockResolvedValue(undefined);
    render(TopBar, { props });
    await user.click(screen.getByRole("button", { name: "New game Mines left 7" }));
    await user.click(screen.getByRole("button", { name: "Hint" }));
    await user.click(screen.getByRole("button", { name: "Bot" }));
    await user.click(screen.getByRole("button", { name: "Pause Time 1:05" }));
    expect([newGame, hint, autoplay, pause].every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("starts a new game from the mines counter, even before the first open", () => {
    game.status = "ready";
    render(TopBar, { props });
    expect(screen.getAllByRole("button", { name: /New game/ })).toHaveLength(1);
    const counter = screen.getByRole("button", { name: "New game Mines left 7" });
    expect(counter).toBeEnabled();
    expect(counter).toHaveAttribute("title", "New game (Ctrl+N)");
  });

  it("pauses from the clock, by keyboard too", async () => {
    const user = userEvent.setup();
    const pause = vi.spyOn(game, "togglePause").mockResolvedValue(undefined);
    render(TopBar, { props });
    expect(screen.getAllByRole("button", { name: /Pause/ })).toHaveLength(1);
    const clock = screen.getByRole("button", { name: "Pause Time 1:05" });
    expect(clock).toHaveAttribute("title", "Pause (P)");
    clock.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("offers Resume from the clock while paused", () => {
    game.paused = true;
    render(TopBar, { props });
    const clock = screen.getByRole("button", { name: "Resume Time 1:05" });
    expect(clock).toBeEnabled();
    expect(clock).toHaveClass("accent");
  });

  it("leaves the clock inert outside play", () => {
    game.status = "ready";
    render(TopBar, { props });
    expect(screen.getByRole("button", { name: "Pause Time 1:05" })).toBeDisabled();
  });

  it("picks tilings and levels from one menu", async () => {
    const user = userEvent.setup();
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    game.previews = [
      { tiling: "square", polygons: snapshot().cells.map((c) => c.polygon), complexity: 2 },
    ];
    render(TopBar, { props });
    await user.click(screen.getByRole("button", { name: "Choose tiling and level" }));
    const squares = screen.getByRole("menuitemradio", { name: "Squares" });
    expect(squares).toHaveAttribute("aria-checked", "true");
    expect(squares.querySelector("svg path")).not.toBeNull();
    expect(squares).toHaveAccessibleDescription("Complexity 2 of 5");
    expect(squares.querySelectorAll(".pips i.on")).toHaveLength(2);
    await user.click(screen.getByRole("menuitemradio", { name: "Hexagons" }));
    expect(newGame).toHaveBeenCalledWith("hexagon");
    await user.click(screen.getByRole("button", { name: "Choose tiling and level" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Crazy" }));
    expect(newGame).toHaveBeenLastCalledWith("square", "crazy");
    await user.click(screen.getByRole("button", { name: "Choose tiling and level" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Custom" }));
    expect(props.onCustomLevel).toHaveBeenCalled();
  });

  it("toggles rules and opens dialogs from the overflow menu", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    render(TopBar, { props });
    const more = () => user.click(screen.getByRole("button", { name: "More options" }));
    await more();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Smart click" }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ rules: { smartClick: false, questionMarks: true } }),
    );
    await more();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Question marks" }));
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ rules: { smartClick: true, questionMarks: false } }),
    );
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    await more();
    await user.click(screen.getByRole("menuitem", { name: /New game/ }));
    expect(newGame).toHaveBeenCalled();
    for (const [label, handler] of [
      ["Saves…", props.onSaves],
      ["Stats", props.onStats],
      ["Settings…", props.onSettings],
      ["About", props.onAbout],
    ] as const) {
      await more();
      await user.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
      expect(handler).toHaveBeenCalled();
    }
    await more();
    await user.click(screen.getByRole("menuitem", { name: "Exit" }));
    expect(appWindow.close).toHaveBeenCalled();
  });

  it("switches players from the overflow menu once there are two", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    render(TopBar, { props });
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "ann" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    game.settings = settings({ profiles: ["ann", "bob"] });
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "ann" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: "bob" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ playerName: "bob" }));
  });

  it("leaves Exit to the app menu on macOS", async () => {
    applyEnvironment("macos", true);
    const user = userEvent.setup();
    render(TopBar, { props });
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitem", { name: "Exit" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Settings/ })).toHaveTextContent("⌘,");
    expect(screen.getByRole("menuitem", { name: /Saves/ })).toHaveTextContent("⌘S");
  });
});

describe("Modal", () => {
  it("drags the window from the backdrop and the title, and keeps the window buttons working", async () => {
    const user = userEvent.setup();
    render(AboutDialog, { props: { open: true } });
    const dialog = screen.getByRole("dialog", { name: "About" });
    expect(dialog).toHaveAttribute("data-tauri-drag-region", "");
    expect(screen.getByRole("heading", { name: "About" })).toHaveAttribute(
      "data-tauri-drag-region",
      "",
    );
    // Only the element itself drags, so the dialog's own controls stay clickable.
    expect(dialog.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    expect(appWindow.minimize).toHaveBeenCalled();
    expect(appWindow.toggleMaximize).toHaveBeenCalled();
    expect(dialog.lastElementChild).toHaveClass("caption");
  });

  it("leaves dragging and the window buttons to the native title bar on Linux", () => {
    applyEnvironment("linux", false);
    render(AboutDialog, { props: { open: true } });
    expect(screen.getByRole("dialog", { name: "About" })).not.toHaveAttribute(
      "data-tauri-drag-region",
    );
    expect(document.querySelector("[data-tauri-drag-region]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize" })).not.toBeInTheDocument();
  });
});

describe("Overlays", () => {
  it("shows the pause card and resumes", async () => {
    const user = userEvent.setup();
    const pause = vi.spyOn(game, "togglePause").mockResolvedValue(undefined);
    game.paused = true;
    render(Overlays);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(pause).toHaveBeenCalled();
  });

  it("resumes on a right click on the pause card", async () => {
    const pause = vi.spyOn(game, "togglePause").mockResolvedValue(undefined);
    game.paused = true;
    render(Overlays);
    await fireEvent.contextMenu(screen.getByRole("presentation"));
    expect(pause).toHaveBeenCalled();
  });

  describe("the drifting dots", () => {
    let hidden = false;
    beforeEach(() => {
      vi.useFakeTimers();
      hidden = false;
      vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
    });
    afterEach(() => vi.useRealTimers());

    const dots = () => screen.getByRole("presentation");

    it("drift for a while after the pause shows, then stop", () => {
      game.paused = true;
      render(Overlays);
      expect(dots()).not.toHaveClass("settled");
      vi.advanceTimersByTime(DRIFT_MS - 1);
      flushSync();
      expect(dots()).not.toHaveClass("settled");
      vi.advanceTimersByTime(1);
      flushSync();
      expect(dots()).toHaveClass("settled");
    });

    it("stop at once when the window loses focus, and drift again on its return", () => {
      game.paused = true;
      render(Overlays);
      window.dispatchEvent(new FocusEvent("blur"));
      flushSync();
      expect(dots()).toHaveClass("settled");
      window.dispatchEvent(new FocusEvent("focus"));
      flushSync();
      expect(dots()).not.toHaveClass("settled");
      vi.advanceTimersByTime(DRIFT_MS);
      flushSync();
      expect(dots()).toHaveClass("settled");
    });

    it("keep still while the page is hidden, and drift once it's shown", () => {
      game.paused = true;
      render(Overlays);
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      flushSync();
      expect(dots()).toHaveClass("settled");
      // No timer may start them again while the page is hidden.
      vi.advanceTimersByTime(DRIFT_MS * 2);
      flushSync();
      expect(dots()).toHaveClass("settled");
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      flushSync();
      expect(dots()).not.toHaveClass("settled");
    });

    it("never start when the game pauses with the window away", () => {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      game.paused = true;
      render(Overlays);
      expect(dots()).toHaveClass("settled");
      document.dispatchEvent(new Event("visibilitychange"));
      flushSync();
      expect(dots()).toHaveClass("settled");
    });

    it("stop listening once the game resumes", () => {
      const remove = vi.spyOn(window, "removeEventListener");
      game.paused = true;
      render(Overlays);
      game.paused = false;
      flushSync();
      expect(remove).toHaveBeenCalledWith("blur", expect.any(Function));
      expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
    });
  });

  it("raises errors as alerts and keeps a live region", () => {
    game.error = "Something went wrong: boom";
    game.announcement = "Row 1, column 1: closed";
    render(Overlays);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("status")).toHaveTextContent("Row 1, column 1: closed");
  });
});

describe("BoardCanvas", () => {
  it("creates the board, applies the theme and pins hint labels", async () => {
    game.hint = { cell: 0, text: "Safe to open", anchor: { x: 50, y: 30, radius: 8 } };
    render(BoardCanvas);
    await vi.waitFor(() => expect(fakeBoard.setTheme).toHaveBeenCalled());
    const label = screen.getByText("Safe to open");
    // Near the top edge the label goes below the cell.
    expect(label).toHaveClass("below");
    expect(label.style.left).toBe("50px");
  });

  it("hides a pinned hint while the game is paused", async () => {
    game.hint = { cell: 0, text: "Safe to open", anchor: { x: 50, y: 30, radius: 8 } };
    render(BoardCanvas);
    await vi.waitFor(() => expect(fakeBoard.setTheme).toHaveBeenCalled());
    game.paused = true;
    flushSync();
    await vi.waitFor(() => expect(screen.queryByText("Safe to open")).toBeNull());
    game.paused = false;
    flushSync();
    expect(screen.getByText("Safe to open")).toBeInTheDocument();
  });

  it("rebuilds the board for a new theme only, not for a hint", async () => {
    const { BoardView } = await import("../lib/board/BoardView");
    // A real rebuild reports its new layout, which moves the hint label.
    fakeBoard.setTheme.mockImplementation(() =>
      vi.mocked(BoardView.create).mock.lastCall?.[2].layoutChanged(),
    );
    try {
      render(BoardCanvas);
      await vi.waitFor(() => expect(fakeBoard.setTheme).toHaveBeenCalled());
      fakeBoard.setTheme.mockClear();
      game.hint = { cell: 0, text: "Safe to open", anchor: null };
      flushSync();
      expect(fakeBoard.setTheme).not.toHaveBeenCalled();
      game.settings = settings({ theme: "pride" });
      flushSync();
      expect(fakeBoard.setTheme).toHaveBeenCalledOnce();
    } finally {
      fakeBoard.setTheme.mockImplementation(() => undefined);
    }
  });

  it("keys every count the board can show, inked with the token that reads best", () => {
    game.settings = settings({ theme: "spectrum" });
    render(BoardCanvas);
    const chips = [...document.querySelectorAll<HTMLElement>(".key .chip")];
    // Square cells have eight neighbors.
    expect(chips.map((chip) => chip.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    for (const chip of chips) {
      expect(chip.style.color).toMatch(/^var\(--legend-ink-(dark|light)\)$/);
    }
  });

  it("hides the key for a harder game when the player turns it off", () => {
    game.settings = settings({ theme: "spectrum", showCountKey: false });
    render(BoardCanvas);
    expect(document.querySelector(".key")).toBeNull();
  });

  it("lights the key chip for the inspected count", async () => {
    game.settings = settings({ theme: "pride" });
    render(BoardCanvas);
    const { BoardView } = await import("../lib/board/BoardView");
    await vi.waitFor(() => expect(BoardView.create).toHaveBeenCalled());
    const handlers = vi.mocked(BoardView.create).mock.lastCall?.[2];
    handlers?.inspect(3);
    flushSync();
    expect(document.querySelector(".chip.on")?.textContent).toBe("3");
    handlers?.inspect(null);
    flushSync();
    expect(document.querySelector(".chip.on")).toBeNull();
  });

  it("shows no key for a theme with digits", () => {
    render(BoardCanvas);
    expect(document.querySelector(".key")).toBeNull();
  });

  it("routes keys to the game", async () => {
    const board = vi.spyOn(game, "focusBoard").mockImplementation(noop);
    const move = vi.spyOn(game, "moveFocus").mockImplementation(noop);
    const open = vi.spyOn(game, "openFocused").mockImplementation(noop);
    const flag = vi.spyOn(game, "flagFocused").mockImplementation(noop);
    render(BoardCanvas);
    const field = screen.getByRole("application");
    await fireEvent.keyDown(field, { key: "ArrowLeft" });
    expect(board).toHaveBeenCalled();
    game.focusedCell = 4;
    await fireEvent.keyDown(field, { key: "ArrowLeft" });
    await fireEvent.keyDown(field, { key: "Enter" });
    await fireEvent.keyDown(field, { key: " " });
    await fireEvent.keyDown(field, { key: "f" });
    await fireEvent.keyDown(field, { key: "x" });
    await fireEvent.keyDown(field, { key: "W" });
    await fireEvent.keyDown(field, { key: "d" });
    await fireEvent.keyDown(field, { key: "a", ctrlKey: true });
    expect(move.mock.calls).toEqual([["left"], ["up"], ["right"]]);
    expect(open).toHaveBeenCalledTimes(2);
    expect(flag).toHaveBeenCalledOnce();
  });

  it("ignores board keys while paused, so hidden cells stay unread", async () => {
    const board = vi.spyOn(game, "focusBoard").mockImplementation(noop);
    const move = vi.spyOn(game, "moveFocus").mockImplementation(noop);
    const open = vi.spyOn(game, "openFocused").mockImplementation(noop);
    game.paused = true;
    game.focusedCell = 4;
    render(BoardCanvas);
    const field = screen.getByRole("application");
    await fireEvent.keyDown(field, { key: "ArrowLeft" });
    await fireEvent.keyDown(field, { key: "Enter" });
    expect(move).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    game.focusedCell = null;
    await fireEvent.keyDown(field, { key: "ArrowLeft" });
    expect(board).not.toHaveBeenCalled();
  });

  it("hides the focus ring on blur", async () => {
    const blur = vi.spyOn(game, "blurBoard").mockImplementation(noop);
    render(BoardCanvas);
    await fireEvent.blur(screen.getByRole("application"));
    expect(blur).toHaveBeenCalled();
  });
});

describe("App", () => {
  beforeEach(() => {
    api.environment.mockResolvedValue({ platform: "windows", material: true });
    api.getSettings.mockResolvedValue(settings());
    api.snapshot.mockResolvedValue(snapshot());
    installMacMenu.mockResolvedValue(vi.fn());
    api.getStats.mockResolvedValue({ players: [], champions: [] });
  });

  /** Waits until startup has loaded the game, so tests don't race it. */
  const started = () =>
    vi.waitFor(() => expect(document.querySelector(".app.ready")).not.toBeNull());

  it("starts up, applies the environment and theme", async () => {
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await vi.waitFor(() =>
      expect(document.documentElement).toHaveClass("platform-windows", "has-material"),
    );
    expect(document.documentElement.dataset.material).toBe("default");
    expect(installMacMenu).not.toHaveBeenCalled();
  });

  it("gives the window the theme's icon once the shell names the platform", async () => {
    render(App);
    await started();
    await vi.waitFor(() =>
      expect(applyWindowIcon).toHaveBeenLastCalledWith(game.theme, "windows", expect.any(Function)),
    );
  });

  it("gives the Dock the new theme's icon on macOS", async () => {
    api.environment.mockResolvedValue({ platform: "macos", material: false });
    render(App);
    await started();
    applyWindowIcon.mockClear();
    game.settings = settings({ theme: "midnight" });
    await vi.waitFor(() =>
      expect(applyWindowIcon).toHaveBeenCalledWith(
        expect.objectContaining({ id: "midnight" }),
        "macos",
        expect.any(Function),
      ),
    );
    const current = applyWindowIcon.mock.calls.at(-1) as unknown as [
      unknown,
      string,
      () => boolean,
    ];
    expect(current[2]()).toBe(true);
  });

  it("checks for updates on startup and offers one it finds", async () => {
    api.environment.mockResolvedValue({ platform: "windows", material: true, updates: true });
    api.checkForUpdate.mockResolvedValueOnce({ version: "9.0.0", notes: null, dateMs: null });
    render(App);
    await started();
    expect(api.checkForUpdate).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Polymine 9.0.0 is available")).toBeInTheDocument();
  });

  it("draws no window buttons once the shell reports Linux", async () => {
    api.environment.mockResolvedValue({ platform: "linux", material: false });
    render(App);
    await started();
    expect(document.documentElement).toHaveClass("platform-linux");
    expect(screen.queryByRole("button", { name: "Minimize" })).not.toBeInTheDocument();
  });

  it("installs the native menu on macOS", async () => {
    api.environment.mockResolvedValue({ platform: "macos", material: false });
    render(App);
    await vi.waitFor(() => expect(installMacMenu).toHaveBeenCalled());
  });

  it("runs a menu shortcut once when the same press also reaches the window", async () => {
    api.environment.mockResolvedValue({ platform: "macos", material: false });
    const hint = vi.spyOn(game, "showHint").mockResolvedValue(undefined);
    render(App);
    await vi.waitFor(() => expect(installMacMenu).toHaveBeenCalled());
    const actions = installMacMenu.mock.calls[0]?.[0] as Record<string, () => void>;
    actions.hint?.();
    await fireEvent.keyDown(window, { key: "h" });
    expect(hint).toHaveBeenCalledTimes(1);
  });

  it("routes native menu commands", async () => {
    api.environment.mockResolvedValue({ platform: "macos", material: false });
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    const hint = vi.spyOn(game, "showHint").mockResolvedValue(undefined);
    const autoplay = vi.spyOn(game, "toggleAutoplay").mockImplementation(noop);
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    render(App);
    await vi.waitFor(() => expect(installMacMenu).toHaveBeenCalled());
    const actions = installMacMenu.mock.calls[0]?.[0] as Record<string, (arg?: string) => void>;
    actions.newGame?.();
    actions.setLevel?.("amateur");
    actions.setTiling?.("cairo");
    actions.hint?.();
    actions.toggleAutoplay?.();
    actions.togglePause?.();
    actions.toggleSmartClick?.();
    actions.toggleQuestionMarks?.();
    expect(newGame.mock.calls).toEqual([[], ["square", "amateur"], ["cairo"]]);
    expect(hint).toHaveBeenCalled();
    expect(autoplay).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    for (const [action, heading] of [
      ["settings", "Settings"],
      ["statistics", "Stats"],
      ["about", "About"],
      ["customLevel", "Custom level"],
    ] as const) {
      actions[action]?.();
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("shows a startup error instead of a blank window", async () => {
    api.environment.mockRejectedValue("no backend");
    render(App);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Polymine couldn't start: no backend",
    );
  });

  it("handles global shortcuts outside text fields", async () => {
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    const hint = vi.spyOn(game, "showHint").mockResolvedValue(undefined);
    const autoplay = vi.spyOn(game, "toggleAutoplay").mockImplementation(noop);
    const pause = vi.spyOn(game, "togglePause").mockResolvedValue(undefined);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "n" });
    await fireEvent.keyDown(window, { key: "F2" });
    await fireEvent.keyDown(window, { key: "h" });
    await fireEvent.keyDown(window, { key: "b" });
    await fireEvent.keyDown(window, { key: "p" });
    await fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(newGame).toHaveBeenCalledTimes(3);
    expect([hint, autoplay, pause].every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("picks levels with number keys and opens the custom level with 5", async () => {
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "3" });
    expect(newGame).toHaveBeenCalledWith("square", "professional");
    await fireEvent.keyDown(window, { key: "5" });
    expect(await screen.findByRole("heading", { name: "Custom level" })).toBeInTheDocument();
  });

  it("opens statistics with F3 and settings with F5", async () => {
    vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "F3" });
    expect(await screen.findByRole("heading", { name: "Stats" })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "F5" });
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("zooms with plus, minus, star and slash", async () => {
    const zoom = vi.spyOn(game, "zoom").mockImplementation(noop);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    for (const key of ["+", "-", "*", "/"]) await fireEvent.keyDown(window, { key });
    expect(zoom.mock.calls).toEqual([["in"], ["out"], ["max"], ["fit"]]);
  });

  it("keeps shortcuts off while a dialog is open, and closes it on Escape from outside", async () => {
    vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    const autoplay = vi.spyOn(game, "toggleAutoplay").mockImplementation(noop);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "F5" });
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // Tab can leave a modal for <body>, where these keys used to reach the game.
    await fireEvent.keyDown(document.body, { key: "b" });
    expect(autoplay).not.toHaveBeenCalled();
    await fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument(),
    );
    expect(appWindow.minimize).not.toHaveBeenCalled();
  });

  it("pauses and minimizes on Escape", async () => {
    const pause = vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "Escape" });
    await vi.waitFor(() => expect(appWindow.minimize).toHaveBeenCalled());
    expect(pause).toHaveBeenCalled();
  });

  it("takes the accent color into system chrome and reads it again on focus", async () => {
    api.environment.mockResolvedValue({ platform: "windows", material: true, accent: 0x0067c0 });
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    const accent = () => document.documentElement.style.getPropertyValue("--accent");
    await vi.waitFor(() => expect(accent()).toBe("#0067c0"));
    appWindow.focusHandler?.({ payload: true });
    await vi.waitFor(() => expect(accent()).toBe("#00ff00"));
    // Midnight brings its own accent and a fixed dark look.
    game.settings = settings({ theme: "midnight" });
    await vi.waitFor(() => expect(accent()).toBe("#36e2c4"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.dataset.material).toBe("none");
    game.settings = settings({ theme: "graphite", accentTint: false });
    await vi.waitFor(() => expect(accent()).toBe(""));
    expect(document.documentElement.style.colorScheme).toBe("");
  });

  it("hides the toolbar when the setting asks", async () => {
    api.getSettings.mockResolvedValue(settings({ hideToolbar: true }));
    const { container } = render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await vi.waitFor(() => expect(container.querySelector(".app.toolbar-hidden")).not.toBeNull());
  });

  it("pauses when the window loses focus or a dialog opens", async () => {
    const pause = vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    const before = pause.mock.calls.length;
    // Only the window losing focus pauses; the page losing it doesn't.
    await fireEvent.blur(window);
    expect(pause.mock.calls.length).toBe(before);
    appWindow.focusHandler?.({ payload: false });
    await vi.waitFor(() => expect(pause.mock.calls.length).toBe(before + 1));
    await fireEvent.keyDown(window, { key: "F3" });
    await vi.waitFor(() => expect(pause.mock.calls.length).toBe(before + 2));
  });

  it("keeps playing while the window is moved or resized, and pauses once it goes behind", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pause = vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
      render(App);
      await started();
      // Moving the window takes focus from the page while the window stays in front.
      api.windowInFront.mockResolvedValue(true);
      appWindow.focusHandler?.({ payload: false });
      await vi.advanceTimersByTimeAsync(1000);
      expect(pause).not.toHaveBeenCalled();
      // The player switches away before the page gets focus back.
      api.windowInFront.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(pause).toHaveBeenCalledTimes(1);
      // The page getting focus back stops the checks.
      api.windowInFront.mockResolvedValue(true);
      appWindow.focusHandler?.({ payload: false });
      appWindow.focusHandler?.({ payload: true });
      api.windowInFront.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(pause).toHaveBeenCalledTimes(1);
    } finally {
      api.windowInFront.mockResolvedValue(false);
      vi.useRealTimers();
    }
  });

  it("keeps playing on focus loss when the setting is off", async () => {
    api.getSettings.mockResolvedValue(settings({ pauseOnFocusLoss: false }));
    const pause = vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    render(App);
    await started();
    appWindow.focusHandler?.({ payload: false });
    expect(pause).not.toHaveBeenCalled();
  });

  it("shows the result in the window title", async () => {
    render(App);
    await started();
    game.gameOver = gameOver("won");
    await vi.waitFor(() =>
      expect(appWindow.setTitle).toHaveBeenLastCalledWith("Polymine: Victory"),
    );
    game.gameOver = null;
    await vi.waitFor(() => expect(appWindow.setTitle).toHaveBeenLastCalledWith("Polymine"));
  });

  it("opens About only when asked, not on a start without settings", async () => {
    render(App);
    await started();
    expect(screen.queryByRole("heading", { name: "About" })).not.toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "F1" });
    expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument();
  });

  it("closes a dialog when its key is pressed again inside it", async () => {
    vi.spyOn(game, "pauseIfPlaying").mockResolvedValue(undefined);
    render(App);
    await started();
    await fireEvent.keyDown(window, { key: "F3" });
    const heading = await screen.findByRole("heading", { name: "Stats" });
    // Another dialog's key does nothing from inside this one.
    await fireEvent.keyDown(heading, { key: "F1" });
    expect(screen.queryByRole("heading", { name: "About" })).not.toBeInTheDocument();
    const dialog = heading.closest("dialog");
    await fireEvent.keyDown(heading, { key: "F3" });
    await vi.waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  });

  it("types 5 into the custom level fields instead of closing the dialog", async () => {
    render(App);
    await started();
    await fireEvent.keyDown(window, { key: "5" });
    const rows = await screen.findByRole("spinbutton", { name: "Rows" });
    await fireEvent.keyDown(rows, { key: "5" });
    expect(rows.closest("dialog")).toHaveAttribute("open");
  });

  it("opens the champions table on a new record with the row marked", async () => {
    api.getStats.mockResolvedValue({
      players: [
        {
          player: "ann",
          games: 1,
          wins: 1,
          avgOpenedPercent: 100,
          avgDurationMs: 12_345,
          avgClicks: 5,
        },
      ],
      champions: [{ player: "ann", durationMs: 12_345, clicks: 5, finishedAt: 1_700_000_000_000 }],
    });
    render(App);
    await started();
    game.gameOver = { ...gameOver("won", { tiling: "kite", level: "amateur" }), championRank: 1 };
    const row = await screen.findByRole("row", { current: true }, { timeout: 3000 });
    expect(row).toHaveTextContent("ann");
    expect(api.getStats).toHaveBeenLastCalledWith("kite", "amateur", null);
  });

  it("opens settings with Ctrl+comma on Windows", async () => {
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens and closes the saves with Ctrl+S on Windows", async () => {
    render(App);
    await screen.findByRole("button", { name: /^New game/ });
    await fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "Saves" })).toBeInTheDocument();
    await fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
      key: "s",
      ctrlKey: true,
    });
    await vi.waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Saves" })).not.toBeInTheDocument(),
    );
  });
});
