import type { ActionResult } from "../lib/bindings";
import type { CellChange } from "../lib/bindings";
import type { CellView } from "../lib/bindings";
import type { GameOver } from "../lib/bindings";
import type { GameSnapshot } from "../lib/bindings";
import type { GameStatus } from "../lib/bindings";
import type { Settings } from "../lib/bindings";
import type { StatsView } from "../lib/bindings";

export const closed: CellView = { kind: "closed", mark: "none" };

/** Each fixture is newer than the last, as the backend's updates are. */
let revision = 0;

/** A square board of unit cells with eight-way neighbors. */
export function snapshot(cols = 3, rows = 3, overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const neighbors: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [nc, nr] = [c + dc, r + dr];
          if ((dc || dr) && nc >= 0 && nr >= 0 && nc < cols && nr < rows) {
            neighbors.push(nr * cols + nc);
          }
        }
      }
      cells.push({
        polygon: [
          { x: c, y: r },
          { x: c + 1, y: r },
          { x: c + 1, y: r + 1 },
          { x: c, y: r + 1 },
        ],
        neighbors,
      });
    }
  }
  return {
    config: { tiling: "square", level: "beginner", cols, rows, mines: 2 },
    cells,
    views: cells.map(() => closed),
    status: "ready",
    counters: { minesLeft: 2, opened: 0, safeCells: cols * rows - 2, clicks: 0 },
    elapsedMs: 0,
    paused: false,
    assisted: false,
    revision: ++revision,
    ...overrides,
  };
}

export function result(
  changes: CellChange[],
  status: GameStatus = "playing",
  extra: Partial<ActionResult> = {},
): ActionResult {
  return {
    update: {
      changes,
      status,
      counters: { minesLeft: 2, opened: changes.length, safeCells: 7, clicks: 1 },
    },
    elapsedMs: 1500,
    gameOver: null,
    revision: ++revision,
    ...extra,
  };
}

export function gameOver(
  outcome: "won" | "lost",
  extra: Partial<GameOver["record"]> = {},
): GameOver {
  return {
    record: {
      player: "ann",
      tiling: "square",
      level: "beginner",
      cols: 3,
      rows: 3,
      mines: 2,
      outcome,
      durationMs: 12_345,
      clicks: 5,
      opened: outcome === "won" ? 7 : 3,
      safeCells: 7,
      assisted: false,
      finishedAt: 1_700_000_000_000,
      ...extra,
    },
    championRank: null,
  };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    playerName: "ann",
    profiles: ["ann"],
    rules: { smartClick: true, questionMarks: true },
    tiling: "square",
    level: "beginner",
    custom: { cols: 16, rows: 16, mines: 40 },
    assistant: {
      moveDelayMs: 10,
      stopWhenUncertain: false,
      autostartNextGame: false,
      idleAction: "off",
      idleSeconds: 30,
    },
    theme: "graphite",
    pauseOnFocusLoss: true,
    accentTint: true,
    fillWindow: false,
    language: "system",
    hideToolbar: false,
    colorFilter: "off",
    ...overrides,
  };
}

export const emptyStats: StatsView = { players: [], champions: [] };
