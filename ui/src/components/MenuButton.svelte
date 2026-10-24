<script lang="ts" module>
  export type MenuEntry =
    | { kind: "action"; label: string; shortcut?: string; onSelect: () => void }
    | { kind: "check" | "radio"; label: string; checked: boolean; onSelect: () => void }
    | { kind: "header"; label: string }
    | { kind: "separator" }
    | { kind: "grid"; label: string; columns: number; items: GridItem[] };

  /** A radio choice drawn as a tile; the menu's `tile` snippet draws its picture. */
  export interface GridItem {
    id: string;
    label: string;
    /** Extra detail for screen readers and the tooltip. */
    description?: string;
    checked: boolean;
    onSelect: () => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import { prefersReducedMotion } from "../lib/platform.svelte";
  import Icon from "./Icon.svelte";

  let {
    entries,
    label,
    title,
    align = "start",
    variant = "button",
    children,
    tile,
  }: {
    entries: MenuEntry[];
    /** Accessible name of the button. */
    label: string;
    title?: string;
    align?: "start" | "end";
    variant?: "button" | "icon";
    children: Snippet;
    /** Draws the picture of a grid item, by its id. */
    tile?: Snippet<[string]>;
  } = $props();

  const ROLES = { action: "menuitem", check: "menuitemcheckbox", radio: "menuitemradio" } as const;
  const uid = `menu-${Math.random().toString(36).slice(2)}`;

  let open = $state(false);
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();

  function items(): HTMLButtonElement[] {
    return [...(menu?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? [])];
  }

  /** Where the flyout opens, from the trigger's place in the window. */
  let place = $state({ top: 0, left: 0, right: 0 });

  function show(focus: "first" | "last" | "none" = "none") {
    const rect = trigger.getBoundingClientRect();
    place = { top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right };
    open = true;
    if (focus === "none") return;
    queueMicrotask(() => {
      const list = items();
      (focus === "first" ? list[0] : list.at(-1))?.focus();
    });
  }

  // The flyout goes to the top layer, so a scrolling dialog or the toolbar
  // can't clip it.
  $effect(() => {
    menu?.showPopover?.();
  });

  function hide(returnFocus = true) {
    open = false;
    if (returnFocus) trigger.focus();
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      show("last");
    } else if (event.key === "Escape" && open) {
      // A menu opened by mouse leaves focus here; Esc must close it, not reach
      // the window's boss key.
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }

  /**
   * Index of the item a vertical arrow reaches from a grid tile: the tile
   * above or below, or the item just past the grid's edge.
   */
  function verticalFromGrid(list: HTMLButtonElement[], index: number, step: 1 | -1) {
    const grid = list[index]?.closest<HTMLElement>("[data-columns]");
    if (!grid) return index + step;
    const tiles = [...grid.querySelectorAll<HTMLButtonElement>("[role^='menuitem']")];
    const at = tiles.indexOf(list[index] as HTMLButtonElement);
    const target = tiles[at + step * Number(grid.dataset.columns)];
    if (target) return list.indexOf(target);
    const edge = step > 0 ? tiles.at(-1) : tiles[0];
    return list.indexOf(edge as HTMLButtonElement) + step;
  }

  function onMenuKey(event: KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    const inGrid = list[index]?.closest("[data-columns]") != null;
    switch (event.key) {
      case "ArrowDown":
        move(verticalFromGrid(list, index, 1));
        break;
      case "ArrowUp":
        move(verticalFromGrid(list, index, -1));
        break;
      case "ArrowRight":
        if (!inGrid) return;
        move(index + 1);
        break;
      case "ArrowLeft":
        if (!inGrid) return;
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        hide();
        break;
      case "Tab":
        hide(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function select(entry: { onSelect: () => void }) {
    hide();
    entry.onSelect();
  }

  function onWindowPointer(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) hide(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="menu-button" bind:this={root}>
  <button
    bind:this={trigger}
    class={variant}
    aria-label={label}
    title={title ?? label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? hide() : show())}
    onkeydown={onTriggerKey}
  >
    {@render children()}
  </button>

  {#if open}
    <div
      class="flyout"
      popover="manual"
      style:top="{place.top}px"
      style:left={align === "start" ? `${place.left}px` : undefined}
      style:right={align === "end" ? `${place.right}px` : undefined}
      role="menu"
      aria-label={label}
      tabindex="-1"
      bind:this={menu}
      onkeydown={onMenuKey}
      transition:fly={{ y: -4, duration: prefersReducedMotion() ? 0 : 120 }}
    >
      {#each entries as entry, i (i)}
        {#if entry.kind === "separator"}
          <div class="separator" role="separator"></div>
        {:else if entry.kind === "header"}
          <div class="header" role="presentation">{entry.label}</div>
        {:else if entry.kind === "grid"}
          <div
            class="grid"
            role="group"
            aria-label={entry.label}
            data-columns={entry.columns}
            style:--columns={entry.columns}
          >
            {#each entry.items as item (item.id)}
              <button
                class="tile"
                role="menuitemradio"
                aria-checked={item.checked}
                aria-label={item.label}
                aria-describedby={item.description ? `${uid}-${item.id}` : undefined}
                title={item.description}
                tabindex="-1"
                onclick={() => select(item)}
              >
                {@render tile?.(item.id)}
                <span class="caption" aria-hidden="true">{item.label}</span>
                {#if item.description}
                  <span id="{uid}-{item.id}" hidden>{item.description}</span>
                {/if}
              </button>
            {/each}
          </div>
        {:else}
          <button
            role={ROLES[entry.kind]}
            aria-checked={entry.kind === "action" ? undefined : entry.checked}
            tabindex="-1"
            onclick={() => select(entry)}
          >
            <span class="mark">
              {#if entry.kind !== "action" && entry.checked}<Icon name="check" size={14} />{/if}
            </span>
            <span class="text">{entry.label}</span>
            {#if entry.kind === "action" && entry.shortcut}
              <span class="shortcut">{entry.shortcut}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu-button {
    position: relative;
  }

  .icon {
    width: var(--control-height);
    padding: 0;
    background: transparent;
    border-color: transparent;
  }

  .icon:hover:not(:disabled) {
    background: var(--subtle-hover);
  }

  .flyout {
    position: fixed;
    inset: auto;
    margin: 0;
    overflow: visible;
    color: var(--text);
    min-width: 220px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    outline: none;
  }

  .flyout button {
    display: flex;
    width: 100%;
    justify-content: flex-start;
    gap: 8px;
    min-height: 32px;
    padding: 0 10px 0 6px;
    background: transparent;
    border: none;
    border-radius: var(--radius);
    color: var(--text);
    text-align: left;
  }

  .flyout button:hover,
  .flyout button:focus-visible {
    background: var(--subtle-hover);
    outline: none;
  }

  :global(.platform-macos) .flyout button {
    min-height: 22px;
  }

  :global(.platform-macos) .flyout button:hover,
  :global(.platform-macos) .flyout button:focus-visible {
    background: var(--accent);
    color: var(--on-menu-highlight);
  }

  .mark {
    display: inline-grid;
    place-items: center;
    width: 16px;
    flex-shrink: 0;
  }

  .text {
    flex: 1;
  }

  .shortcut {
    color: var(--text-dim);
    font-size: var(--font-caption);
  }

  .header {
    padding: 6px 10px 2px 30px;
    font-size: var(--font-caption);
    font-weight: 600;
    color: var(--text-dim);
  }

  .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--divider);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--columns), 88px);
    gap: 2px;
    padding: 2px;
  }

  .flyout .tile {
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 4px;
    text-align: center;
  }

  .flyout .tile[aria-checked="true"] {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  /* Tiles keep their pictures readable, so macOS's accent hover stays subtle here. */
  :global(.platform-macos) .flyout .tile:hover,
  :global(.platform-macos) .flyout .tile:focus-visible {
    background: var(--subtle-hover);
    color: var(--text);
  }

  .caption {
    font-size: var(--font-caption);
    line-height: 1.2;
  }
</style>
