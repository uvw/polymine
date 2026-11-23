<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { hasShell } from "../lib/api";
  import { BoardView } from "../lib/board/BoardView";
  import type { Direction } from "../lib/board/navigation";
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import { cssColor } from "../lib/themes/color";
  import { countKey, prefersDarkInk } from "../lib/themes/counts";
  import { attachWindowFit } from "../lib/windowFit";
  import { attachWindowZoom } from "../lib/windowZoom";

  let host: HTMLDivElement;
  let view = $state<BoardView | null>(null);
  /** The count on the cell under the pointer or the keyboard focus. */
  let inspected = $state<number | null>(null);

  onMount(() => {
    let disposed = false;
    const detachZoom = hasShell() ? attachWindowZoom(host) : undefined;
    const detachFit = hasShell()
      ? attachWindowFit(() =>
          view
            ? { fittedHost: (across, down) => view?.fittedHost(across, down) ?? null, host }
            : null,
        )
      : undefined;
    void BoardView.create(host, game.theme.board, {
      primary: (cell) => void game.primary(cell),
      secondary: (cell) => void game.secondary(cell),
      fieldSecondary: () => void game.fieldSecondary(),
      pointerPress: (cell) => game.pointerPress(cell),
      layoutChanged: () => {
        game.boardArea = { width: host.clientWidth, height: host.clientHeight };
        game.boardLayoutChanged();
      },
      inspect: (count) => (inspected = count),
    }).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      view = created;
      game.attachBoard(created);
      // Lets automated UI checks find cells in development builds.
      if (import.meta.env.DEV) Object.assign(window, { __polymine: { board: created, game } });
    });
    return () => {
      disposed = true;
      detachZoom?.();
      detachFit?.();
      game.detachBoard();
      view?.destroy();
    };
  });

  $effect(() => {
    const current = view;
    const theme = game.theme.board;
    // A rebuild reports its layout to the game, which reads and rewrites the
    // hint. Tracked here, that would rebuild the board for every hint, and
    // the rewrite would make the effect run itself until Svelte gives up.
    untrack(() => current?.setTheme(theme));
  });

  const board = $derived(game.theme.board);
  const plate = $derived(board.plate);

  /** The most neighbors a cell has on this board, so the highest count it can show. */
  const maxCount = $derived(
    (game.snapshot?.cells ?? []).reduce((most, cell) => Math.max(most, cell.neighbors.length), 0),
  );
  /** Color-only themes show a key of every count this board can show, below the cells. */
  const key = $derived(
    board.numberStyle === "colors" && game.settings?.showCountKey !== false
      ? countKey(board, maxCount)
      : [],
  );
  const ink = (color: number) =>
    prefersDarkInk(color) ? "var(--legend-ink-dark)" : "var(--legend-ink-light)";

  /** Label above the cell, or below it when the cell is near the top. */
  const hintStyle = $derived.by(() => {
    const anchor = game.hint?.anchor;
    if (!anchor) return null;
    const below = anchor.y < 64;
    const offset = anchor.radius + 10;
    return {
      left: `${anchor.x}px`,
      top: `${below ? anchor.y + offset : anchor.y - offset}px`,
      below,
    };
  });

  const MOVES: Record<string, Direction> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    s: "down",
    a: "left",
    d: "right",
  };

  /** The move a key makes on the board. Modifier chords stay with the shortcuts. */
  function moveFor(event: KeyboardEvent): Direction | undefined {
    if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
    return MOVES[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  }

  /** Shows the focus ring only for keyboard focus, never after a mouse click. */
  function onFocus() {
    if (!game.paused && host.matches(":focus-visible")) game.focusBoard();
  }

  function onKeydown(event: KeyboardEvent) {
    // A paused board hides its cells, so the keys mustn't read them out.
    if (game.paused) return;
    const direction = moveFor(event);
    if (game.focusedCell === null && (direction || event.key === "Enter" || event.key === " ")) {
      // First key after a mouse click: show where the focus is before acting.
      game.focusBoard();
    } else if (direction) {
      game.moveFocus(direction);
    } else if (event.key === "Enter" || event.key === " ") {
      game.openFocused();
    } else if (event.key.toLowerCase() === "f") {
      game.flagFocused();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<div
  class="plate"
  class:tray={plate !== null}
  class:keyed={key.length > 0}
  style:--plate={`color-mix(in srgb, ${cssColor(plate)} ${board.plateAlpha * 100}%, transparent)`}
>
  <!-- Keyboard play: the host is one focusable widget; arrow keys move between cells.
       Svelte doesn't count role="application" as interactive, hence the ignore. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="board"
    bind:this={host}
    role="application"
    aria-roledescription={t("a11y.boardRole")}
    aria-label={t("a11y.board")}
    tabindex="0"
    onkeydown={onKeydown}
    onfocus={onFocus}
    onblur={() => game.blurBoard()}
  ></div>

  {#if key.length > 0}
    <!-- Screen readers hear each count as the focus reaches it, so the key is visual only. -->
    <div
      class="key"
      class:inspecting={inspected !== null}
      style:--key-open={cssColor(board.open)}
      style:--key-focus={cssColor(board.focus)}
      aria-hidden="true"
    >
      {#each key as entry (entry.from)}
        <span
          class="chip"
          class:ring={entry.ring}
          class:on={inspected !== null && inspected >= entry.from && inspected <= entry.to}
          style:--chip={cssColor(entry.color)}
          style:color={ink(entry.ring ? board.open : entry.color)}
        >
          {entry.from === entry.to ? entry.from : `${entry.from}–${entry.to}`}
        </span>
      {/each}
    </div>
  {/if}

  <!-- The Paused card covers only the middle, and a paused board hides the cell. -->
  {#if game.hint && hintStyle && !game.paused}
    <div
      class="hint"
      class:below={hintStyle.below}
      style:left={hintStyle.left}
      style:top={hintStyle.top}
      transition:fade={{ duration: 120 }}
    >
      {game.hint.text}
    </div>
  {/if}
</div>

<style>
  .plate {
    --key-chip: 22px;
    --key-space: calc(var(--key-chip) + 12px);
    position: absolute;
    inset: 0;
  }

  .plate.tray {
    inset: 0 4px 4px;
    background: var(--plate);
    border-radius: var(--radius-lg);
    box-shadow: inset 0 1px 3px var(--plate-shadow);
  }

  /* The key takes a strip under the board, so it never covers a cell. */
  .plate.keyed .board {
    bottom: var(--key-space);
  }

  .key {
    position: absolute;
    right: 0;
    bottom: 8px;
    left: 0;
    display: flex;
    justify-content: center;
    gap: 4px;
    pointer-events: none;
  }

  .chip {
    display: grid;
    place-items: center;
    min-width: var(--key-chip);
    height: var(--key-chip);
    padding: 0 5px;
    border-radius: var(--radius);
    background: var(--chip);
    /* An edge for chips as light as what's behind them, like Pride's white. */
    box-shadow: inset 0 0 0 1px var(--stroke-strong);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    transition:
      opacity 0.12s ease,
      transform 0.12s ease;
  }

  .chip.ring {
    background: var(--key-open);
    box-shadow: inset 0 0 0 5px var(--chip);
  }

  /* The chip for the inspected cell's count stands out, and the rest step back. */
  .inspecting .chip {
    opacity: 0.35;
  }

  .inspecting .chip.on {
    opacity: 1;
    transform: scale(1.15);
    outline: 2px solid var(--key-focus);
    outline-offset: 1px;
  }

  .board {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    outline: none;
    /* The board handles taps, long presses, and pinches itself. */
    touch-action: none;
  }

  .hint {
    position: absolute;
    transform: translate(-50%, -100%);
    max-width: 280px;
    padding: 6px 10px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--stroke);
    box-shadow: var(--shadow);
    font-size: var(--font-caption);
    pointer-events: none;
    white-space: nowrap;
  }

  .hint.below {
    transform: translate(-50%, 0);
  }

  .board :global(canvas) {
    display: block;
  }
</style>
