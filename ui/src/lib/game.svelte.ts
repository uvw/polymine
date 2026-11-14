import { MediaQuery } from "svelte/reactivity";
import { api } from "./api";
import type { ActionResult } from "./bindings";
import type { CellView } from "./bindings";
import type { Counters } from "./bindings";
import type { CustomSize } from "./bindings";
import type { ExternalChange } from "./bindings";
import type { GameOver } from "./bindings";
import type { GameSnapshot } from "./bindings";
import type { GameStatus } from "./bindings";
import type { Level } from "./bindings";
import type { Point } from "./bindings";
import type { Settings } from "./bindings";
import type { Suggestion } from "./bindings";
import type { TilingId } from "./bindings";
import type { TilingPreview } from "./bindings";
import { PADDING, type BoardView, type CellAnchor } from "./board/BoardView";
import { centroid } from "./board/geometry";
import { neighborToward, type Direction } from "./board/navigation";
import { describeCell, describeHint } from "./describe";
import { formatDuration, formatPercent } from "./format";
import { t } from "./i18n";
import { BUILT_IN_THEMES, findTheme, themeFor } from "./themes/catalog";
import { filterTheme } from "./themes/filter";
import { pickTheme, rotationPool } from "./themes/gallery";
import { ThemeLibrary } from "./themes/library.svelte";
import type { ThemeEnv } from "./themes/resolve";
import type { Theme, ThemeEntry } from "./themes/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** The smallest cell's inradius on a board sized to fill the window, in CSS pixels. */
const FILL_INRADIUS = 12;
/** How long the window must stay one size before a fresh board follows it. */
const REFILL_MS = 400;
const ERROR_MS = 5000;
const AUTOSTART_PAUSE_MS = 1800;

export interface HintLabel {
  cell: number;
  text: string;
  anchor: CellAnchor | null;
}

/** App-wide game state. Components read its fields; only its methods talk to the backend. */
export class GameStore {
  snapshot = $state.raw<GameSnapshot | null>(null);
  status = $state<GameStatus>("ready");
  counters = $state<Counters>({ minesLeft: 0, opened: 0, safeCells: 0, clicks: 0 });
  /** Whole seconds on the clock; changes once a second at most. */
  elapsedSeconds = $state(0);
  paused = $state(false);
  assisted = $state(false);
  autoplay = $state(false);
  /** Bumped each time autoplay turns on, so an older loop knows to stop. */
  private autoplayRun = 0;
  settings = $state.raw<Settings | null>(null);
  previews = $state.raw<TilingPreview[]>([]);
  gameOver = $state.raw<GameOver | null>(null);
  hint = $state.raw<HintLabel | null>(null);
  error = $state<string | null>(null);
  /** Polite screen reader announcement. */
  announcement = $state("");
  focusedCell = $state<number | null>(null);
  /** The cell last pressed with the pointer, where the keyboard picks up again. */
  private pressedCell: number | null = null;
  /** The board host's size in CSS pixels, once it has been laid out. */
  boardArea = $state.raw<{ width: number; height: number } | null>(null);

  /** The system accent color, when the platform has one. */
  accent = $state<number | null>(null);
  private readonly dark = new MediaQuery("(prefers-color-scheme: dark)");

  /** Player themes from the data folder. */
  readonly library = new ThemeLibrary(BUILT_IN_THEMES);
  /** Every theme the player can pick, built-in ones first. */
  readonly themes: readonly ThemeEntry[] = $derived([...BUILT_IN_THEMES, ...this.library.user]);
  /** What themes resolve against: the accent, unless the player turned the tint off, and the mode. */
  readonly themeEnv: ThemeEnv = $derived({
    accent: this.settings?.accentTint === false ? null : this.accent,
    dark: this.dark.current,
  });
  /** The chosen theme, through the player's color filter. */
  readonly theme: Theme = $derived(
    filterTheme(
      themeFor(findTheme(this.themes, this.settings?.theme), this.themeEnv),
      this.settings?.colorFilter,
    ),
  );

  private board: BoardView | null = null;
  private views: CellView[] = [];
  private centers: Point[] = [];
  /** Serializes backend calls so clicks apply in the order they happened. */
  private queue: Promise<unknown> = Promise.resolve();
  private clockBase = 0;
  private clockStartedAt: number | null = null;
  private lastActivity = performance.now();
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private refillTimer: ReturnType<typeof setTimeout> | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private unlisten: (() => void) | null = null;
  /** Bumped by `init` and `dispose`, so a startup that outlives its store stops. */
  private generation = 0;
  /** The backend's change count as of the newest update shown. */
  private revision = 0;

  async init(): Promise<void> {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    [this.settings, this.previews] = await Promise.all([
      api.getSettings(),
      api.tilingPreviews(),
      this.library.load(),
    ]);
    await this.library.loadGlyphs(this.settings.theme);
    const snapshot = await api.snapshot();
    if (!current()) return;
    this.load(snapshot);
    const unlisten = await api.onExternalChange((change) => void this.external(change));
    if (!current()) {
      unlisten();
      return;
    }
    this.unlisten = unlisten;
    this.timers.push(
      setInterval(() => this.tickClock(), 250),
      setInterval(() => void this.checkIdle(), 1000),
    );
  }

  attachBoard(board: BoardView): void {
    this.board = board;
    if (this.snapshot) board.load(this.snapshot);
  }

  detachBoard(): void {
    this.board = null;
  }

  /** The board moved; DOM labels pinned to cells must follow. */
  boardLayoutChanged(): void {
    if (this.hint)
      this.hint = { ...this.hint, anchor: this.board?.anchorOf(this.hint.cell) ?? null };
    this.scheduleRefill();
  }

  /**
   * The custom size that fills the board area with cells of a comfortable
   * size, with mines at `density`, or `null` before the board is laid out.
   */
  async fillSize(tiling: TilingId, density: number): Promise<CustomSize | null> {
    const area = this.boardArea;
    if (!area) return null;
    const inner = (side: number) => Math.max(0, Math.floor(side - 2 * PADDING));
    const { cols, rows } = await api.fitBoard(
      tiling,
      inner(area.width),
      inner(area.height),
      FILL_INRADIUS,
    );
    const mines = Math.min(cols * rows - 1, Math.max(1, Math.round(cols * rows * density)));
    return { cols, rows, mines };
  }

  /** Mine density of the saved custom size. */
  private customDensity(): number {
    const custom = this.settings?.custom;
    return custom ? custom.mines / (custom.cols * custom.rows) : 0.15;
  }

  /**
   * With "fill the window" on, a custom game nobody has touched yet follows
   * the window once it stops changing size.
   */
  private scheduleRefill(): void {
    if (!this.refillable()) return;
    clearTimeout(this.refillTimer);
    this.refillTimer = setTimeout(() => {
      void (async () => {
        const tiling = this.tiling;
        const size = await this.fillSize(tiling, this.customDensity());
        if (!size) return;
        // Clicks queued while the size was worked out run first, and a game
        // they start must stay.
        await this.run(async () => {
          const config = this.snapshot?.config;
          if (!config || config.tiling !== tiling || !this.refillable()) return;
          if (size.cols !== config.cols || size.rows !== config.rows) {
            // A resize isn't a new game to the player, so the theme stays.
            await this.start(tiling, "custom", size, false);
          }
        });
      })();
    }, REFILL_MS);
  }

  private refillable(): boolean {
    return !!this.settings?.fillWindow && this.level === "custom" && this.status === "ready";
  }

  get tiling(): TilingId {
    return this.snapshot?.config.tiling ?? "square";
  }

  get level(): Level {
    return this.snapshot?.config.level ?? "beginner";
  }

  /**
   * Starts a game. Without arguments it repeats the current tiling and level,
   * and on a paused game it only resumes, so a stray New Game can't throw
   * away a game in progress.
   */
  newGame(tiling?: TilingId, level?: Level, custom?: CustomSize): Promise<void> {
    if (this.paused && tiling === undefined && level === undefined) {
      return this.togglePause();
    }
    return this.startGame(tiling ?? this.tiling, level ?? this.level, custom);
  }

  private startGame(tiling: TilingId, level: Level, custom?: CustomSize) {
    return this.run(() => this.start(tiling, level, custom));
  }

  /** Starts a game right away; callers outside the queue go through `startGame`. */
  private async start(
    tiling: TilingId,
    level: Level,
    custom?: CustomSize,
    rotate = true,
  ): Promise<void> {
    let size = custom ?? (level === "custom" ? this.settings?.custom : undefined);
    if (level === "custom" && !custom && this.settings?.fillWindow) {
      size = (await this.fillSize(tiling, this.customDensity())) ?? size;
    }
    this.load(await api.newGame({ tiling, level, custom: size ?? null }));
    this.settings = await api.getSettings();
    if (rotate) await this.rotateTheme();
  }

  /** Switches to another theme for the new game when the player asked for one each game. */
  private async rotateTheme(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    const pool = rotationPool(this.themes, settings.themeRotation, settings.favoriteThemes);
    const theme = pickTheme(pool, settings.theme);
    if (!theme) return;
    this.settings = await api.updateSettings({ ...settings, theme });
    await this.library.loadGlyphs(theme);
  }

  primary(cell: number) {
    this.takeOverFromAutoplay();
    return this.run(async () => this.applyResult(await api.primary(cell)));
  }

  /** Right click on a cell. After a game ends it starts the next one. */
  secondary(cell: number) {
    if (this.status === "won" || this.status === "lost") return this.newGame();
    this.takeOverFromAutoplay();
    return this.run(async () => this.applyResult(await api.secondary(cell)));
  }

  /**
   * Right click anywhere on the field that isn't a cell, or anywhere while
   * paused: resumes a paused game and starts a new one after a game ends.
   */
  fieldSecondary(): Promise<void> {
    if (this.paused) return this.togglePause();
    if (this.status === "won" || this.status === "lost") return this.newGame();
    return Promise.resolve();
  }

  /** Pauses a game in play, for example when the window loses focus. */
  pauseIfPlaying(): Promise<void> {
    if (this.status !== "playing" || this.paused || this.autoplay) return Promise.resolve();
    return this.togglePause();
  }

  zoom(step: "in" | "out" | "fit" | "max"): void {
    this.board?.setZoom(step);
  }

  /** The player's own click stops autoplay and restarts the idle timer. */
  private takeOverFromAutoplay(): void {
    this.lastActivity = performance.now();
    this.autoplay = false;
  }

  showHint() {
    return this.run(async () => {
      const suggestion = await api.hint();
      if (!suggestion) return;
      this.assisted = true;
      this.pinHint(suggestion, describeSuggestion(suggestion));
    });
  }

  togglePause() {
    if (this.status !== "playing" && !this.paused) return Promise.resolve();
    return this.run(async () => {
      const snapshot = await api.setPaused(!this.paused);
      this.revision = Math.max(this.revision, snapshot.revision);
      this.paused = snapshot.paused;
      this.board?.setLocked(this.paused);
      this.syncClock(snapshot.elapsedMs, snapshot.status);
    });
  }

  toggleAutoplay(): void {
    this.autoplay = !this.autoplay;
    if (this.autoplay) void this.runAutoplay(++this.autoplayRun);
  }

  updateSettings(settings: Settings) {
    return this.run(async () => {
      this.settings = await api.updateSettings(settings);
      void this.library.loadGlyphs(this.settings.theme);
    });
  }

  /** Keeps the game in play under `name`; the shell refuses a fresh or finished one. */
  saveAs(name: string) {
    return this.run(() => api.saveAs(name));
  }

  /** Replaces the game in play with the save `name`. It comes back paused and assisted. */
  loadSave(name: string) {
    this.takeOverFromAutoplay();
    return this.run(async () => this.load(await api.loadSave(name)));
  }

  /** Reads the themes folder again, for themes added or edited while Polymine ran. */
  async reloadThemes(): Promise<void> {
    await this.library.load();
    await this.library.loadGlyphs(this.settings?.theme);
  }

  openThemesFolder() {
    return this.run(() => api.openThemesFolder());
  }

  /**
   * Puts the keyboard focus ring on the board: on the focused cell, else the
   * cell last pressed with the pointer, else the middle.
   */
  focusBoard(): void {
    const cell = this.focusedCell ?? this.pressedCell ?? Math.floor(this.centers.length / 2);
    this.moveFocusTo(cell);
  }

  /** A pointer press hides the ring; the next key brings it back at the pressed cell. */
  pointerPress(cell: number | null): void {
    this.pressedCell = cell;
    if (this.focusedCell === null) return;
    this.focusedCell = null;
    this.board?.setFocus(null);
  }

  blurBoard(): void {
    this.board?.setFocus(null);
  }

  moveFocus(direction: Direction): void {
    const from = this.focusedCell;
    const neighbors = this.snapshot?.cells.map((c) => c.neighbors);
    if (from === null || !neighbors) return;
    const next = neighborToward(from, direction, this.centers, neighbors);
    if (next !== null) this.moveFocusTo(next);
  }

  openFocused(): void {
    if (this.focusedCell !== null) void this.primary(this.focusedCell);
  }

  flagFocused(): void {
    if (this.focusedCell !== null) void this.secondary(this.focusedCell);
  }

  dispose(): void {
    this.generation++;
    for (const timer of this.timers) clearInterval(timer);
    clearTimeout(this.refillTimer);
    clearTimeout(this.errorTimer);
    this.timers = [];
    this.autoplay = false;
    this.unlisten?.();
    this.unlisten = null;
  }

  /**
   * Shows a move or new game made from outside the window, in order with
   * clicks. Events arrive outside the backend's lock, so one can be older
   * than an update already shown: its cells then come from a fresh snapshot.
   */
  private external(change: ExternalChange): Promise<void> {
    return this.run(async () => {
      if (change.kind === "reload") {
        // A new game from the CLI also saves its tiling and level, so the
        // settings are re-read; a stale copy would undo them on the next save.
        const [snapshot, settings] = await Promise.all([api.snapshot(), api.getSettings()]);
        this.settings = settings;
        if (snapshot.revision >= this.revision) this.load(snapshot);
      } else if (!this.applyResult(change.result)) {
        await this.resync(change.result.gameOver);
      }
    });
  }

  /** Reloads the board after a late update, keeping the result of a finished game. */
  private async resync(late: GameOver | null): Promise<void> {
    const snapshot = await api.snapshot();
    if (snapshot.revision < this.revision) return;
    const over = this.gameOver ?? late;
    this.load(snapshot);
    if (snapshot.status === "won" || snapshot.status === "lost") this.gameOver = over;
  }

  private moveFocusTo(cell: number): void {
    this.focusedCell = cell;
    this.board?.setFocus(cell);
    this.announceCell(cell);
  }

  private announceCell(cell: number): void {
    const view = this.views[cell];
    if (view) this.announce(describeCell(view, ...this.rowAndColumn(cell)));
  }

  private rowAndColumn(cell: number): [row: number, col: number] {
    const cols = this.snapshot?.config.cols ?? 1;
    return [Math.floor(cell / cols), cell % cols];
  }

  private announce(text: string): void {
    // Clearing first makes screen readers repeat identical messages.
    this.announcement = "";
    queueMicrotask(() => (this.announcement = text));
  }

  private pinHint(suggestion: Suggestion, text: string): void {
    this.board?.showHint(suggestion.cell, suggestion.action);
    this.hint = {
      cell: suggestion.cell,
      text,
      anchor: this.board?.anchorOf(suggestion.cell) ?? null,
    };
    this.announce(describeHint(text, ...this.rowAndColumn(suggestion.cell)));
  }

  private load(snapshot: GameSnapshot): void {
    this.revision = snapshot.revision;
    this.snapshot = snapshot;
    this.views = [...snapshot.views];
    this.centers = snapshot.cells.map((c) => centroid(c.polygon));
    this.status = snapshot.status;
    this.counters = snapshot.counters;
    this.paused = snapshot.paused;
    this.assisted = snapshot.assisted;
    this.gameOver = null;
    this.hint = null;
    this.focusedCell = null;
    this.pressedCell = null;
    this.syncClock(snapshot.elapsedMs, snapshot.status);
    this.board?.load(snapshot);
    this.board?.setLocked(snapshot.paused);
  }

  /** Shows an action's changes. Returns false, changing nothing, when it's older than the board. */
  private applyResult(result: ActionResult): boolean {
    if (result.revision <= this.revision) return false;
    this.revision = result.revision;
    const { update } = result;
    for (const change of update.changes) this.views[change.cell] = change.view;
    if (update.changes.length > 0) {
      this.hint = null;
      this.board?.apply(update.changes, update.status);
    }
    this.status = update.status;
    this.counters = update.counters;
    this.syncClock(result.elapsedMs, update.status);
    if (this.focusedCell !== null && update.changes.some((c) => c.cell === this.focusedCell)) {
      this.announceCell(this.focusedCell);
    }
    if (result.gameOver) {
      this.gameOver = result.gameOver;
      this.assisted = result.gameOver.record.assisted;
      this.announce(describeGameOver(result.gameOver));
    }
    return true;
  }

  /**
   * Plays until autoplay turns off or a newer run starts. A loop only notices
   * the switch between moves, so turning autoplay off and on within one move
   * delay would otherwise leave two loops playing.
   */
  private async runAutoplay(run: number): Promise<void> {
    const current = () => this.autoplay && run === this.autoplayRun;
    while (current()) {
      const assistant = this.settings?.assistant;
      if (this.paused) {
        await sleep(200);
        continue;
      }
      if (this.status === "won" || this.status === "lost") {
        if (!assistant?.autostartNextGame) break;
        await sleep(AUTOSTART_PAUSE_MS);
        if (current()) await this.startGame(this.tiling, this.level);
        continue;
      }
      const outcome = await this.run(() => api.assist(!assistant?.stopWhenUncertain));
      if (run !== this.autoplayRun) return;
      if (!outcome) break;
      if (!outcome.result) {
        this.pinHint(outcome.suggestion, t("hint.stopped"));
        break;
      }
      this.assisted = true;
      this.applyResult(outcome.result);
      await sleep(assistant?.moveDelayMs ?? 120);
    }
    if (run === this.autoplayRun) this.autoplay = false;
  }

  private async checkIdle(): Promise<void> {
    const assistant = this.settings?.assistant;
    if (!assistant || assistant.idleAction === "off" || this.paused || this.autoplay) return;
    if (performance.now() - this.lastActivity < assistant.idleSeconds * 1000) return;
    this.lastActivity = performance.now();
    if (assistant.idleAction === "autoplay") {
      if (this.status !== "won" && this.status !== "lost") this.toggleAutoplay();
    } else if (this.status === "playing" && !this.hint) {
      await this.showHint();
    }
  }

  private syncClock(elapsedMs: number, status: GameStatus): void {
    this.clockBase = elapsedMs;
    this.clockStartedAt = status === "playing" && !this.paused ? performance.now() : null;
    this.setSeconds(elapsedMs);
  }

  private tickClock(): void {
    if (this.clockStartedAt !== null) {
      this.setSeconds(this.clockBase + (performance.now() - this.clockStartedAt));
    }
  }

  private setSeconds(ms: number): void {
    const seconds = Math.floor(ms / 1000);
    if (seconds !== this.elapsedSeconds) this.elapsedSeconds = seconds;
  }

  /** Shows a failed backend call to the player for a few seconds. */
  reportError(error: unknown): void {
    this.error = t("error.generic", { message: String(error) });
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => (this.error = null), ERROR_MS);
  }

  /** Queues a backend call behind earlier ones and reports failures. */
  private run<T>(task: () => Promise<T>): Promise<T | undefined> {
    const next = this.queue.then(task).catch((error: unknown) => {
      this.reportError(error);
      return undefined;
    });
    this.queue = next;
    return next;
  }
}

function describeSuggestion(s: Suggestion): string {
  if (!s.certain) {
    const percent = `${Math.round(s.mineProbability * 100)}%`;
    return t(s.exact ? "hint.guess" : "hint.guessEstimate", { percent });
  }
  switch (s.action) {
    case "open":
      return t("hint.open");
    case "flag":
      return t("hint.flag");
    case "unflag":
      return t("hint.unflag");
  }
}

export function describeGameOver(over: GameOver): string {
  const { record } = over;
  if (record.outcome === "won") return t("over.won", { time: formatDuration(record.durationMs) });
  return t("over.lost", {
    percent: formatPercent((record.opened * 100) / Math.max(1, record.safeCells)),
  });
}

export const game = new GameStore();
