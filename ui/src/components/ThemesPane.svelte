<script lang="ts">
  import { onMount } from "svelte";
  import type { Settings, ThemeRotation } from "../lib/bindings";
  import { formatNumber } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import { t, type MessageKey } from "../lib/i18n";
  import { editorPlacement, themeGroup, type ThemeGroup } from "../lib/themes/builtin";
  import { themeFor } from "../lib/themes/catalog";
  import { filterTheme } from "../lib/themes/filter";
  import {
    filterThemes,
    gallerySections,
    knownIds,
    pickTheme,
    type ThemeSource,
  } from "../lib/themes/gallery";
  import type { ThemeEntry } from "../lib/themes/types";
  import Flyout from "./Flyout.svelte";
  import Icon from "./Icon.svelte";
  import ThemePreview from "./ThemePreview.svelte";

  let {
    draft = $bindable(),
    idPrefix,
    bounds,
    scrolled = 0,
  }: {
    draft: Settings;
    idPrefix: string;
    /** What flyouts stay inside. */
    bounds?: HTMLElement;
    /** Bumped when the page scrolls, which leaves a flyout pointing at nothing. */
    scrolled?: number;
  } = $props();

  const GROUP_LABELS: Record<ThemeGroup, MessageKey> = {
    polymine: "settings.themesPolymine",
    editor: "settings.themesEditor",
    player: "settings.themesPlayer",
  };

  const ROTATIONS: readonly { value: ThemeRotation; label: MessageKey }[] = [
    { value: "off", label: "settings.rotationOff" },
    { value: "favorites", label: "settings.rotationFavorites" },
    { value: "all", label: "settings.rotationAll" },
  ];

  const MODES: readonly { value: "light" | "dark"; label: MessageKey }[] = [
    { value: "light", label: "settings.themesLight" },
    { value: "dark", label: "settings.themesDark" },
  ];

  /** How long the pointer rests on a theme before its flyout shows. */
  const TIP_DELAY_MS = 500;
  /** Lets the pointer cross from a theme to its flyout, so the flyout's text can be selected. */
  const TIP_GRACE_MS = 150;
  /** How long the pointer rests on a card before the board behind the dialog tries it on. */
  const TRY_ON_DELAY_MS = 300;

  let query = $state("");
  let source = $state<ThemeSource>("all");
  let mode = $state<"light" | "dark" | null>(null);
  /** The theme whose flyout shows, and the card it points at. */
  let tip = $state<{ id: string; card: HTMLElement } | null>(null);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the last key went to a theme, so an arrow moving focus counts as the keyboard's. */
  let viaKeys = false;
  let tryOnTimer: ReturnType<typeof setTimeout> | undefined;
  let gallery = $state<HTMLElement>();

  const hasPlayerThemes = $derived(game.themes.some((e) => themeGroup(e) === "player"));
  const sources = $derived([
    { value: "all", label: "settings.themesAll" },
    { value: "polymine", label: "settings.themesPolymine" },
    { value: "editor", label: "settings.themesEditor" },
    ...(hasPlayerThemes ? [{ value: "player", label: "settings.themesPlayer" }] : []),
    { value: "favorites", label: "settings.themesFavorites" },
  ] as { value: ThemeSource; label: MessageKey }[]);
  const shown = $derived(
    filterThemes(game.themes, { query, source, mode, favorites: draft.favoriteThemes }),
  );
  const sections = $derived(gallerySections(shown));
  const filtering = $derived(query.trim() !== "" || source !== "all" || mode !== null);
  const recent = $derived(
    knownIds(game.themes, draft.recentThemes).flatMap(
      (id) => game.themes.find((e) => e.id === id) ?? [],
    ),
  );

  /** Previews resolve as the board does, with the accent while the tint is on. */
  const previewEnv = $derived({
    accent: draft.accentTint === false ? null : game.accent,
    dark: game.themeEnv.dark,
  });
  const boardOf = (entry: ThemeEntry) =>
    filterTheme(themeFor(entry, previewEnv), draft.colorFilter).board;

  // A player theme's glyphs load only once it's chosen, so its card would draw plain digits.
  onMount(() => {
    for (const entry of game.themes) {
      if (!entry.builtIn) void game.library.loadGlyphs(entry.id);
    }
    return () => {
      clearTimeout(tipTimer);
      clearTimeout(tryOnTimer);
      game.tryOn(null);
    };
  });

  $effect(() => {
    if (scrolled) hideTip();
  });

  // Leaving every card puts the chosen theme back on the board.
  $effect(() => {
    gallery?.addEventListener("pointerleave", stopTryingOn);
    return () => gallery?.removeEventListener("pointerleave", stopTryingOn);
  });

  function toggleFavorite(id: string) {
    draft.favoriteThemes = draft.favoriteThemes.includes(id)
      ? draft.favoriteThemes.filter((f) => f !== id)
      : [...draft.favoriteThemes, id];
  }

  function surprise() {
    const id = pickTheme(shown, draft.theme);
    if (id) draft.theme = id;
  }

  function tryOnLater(id: string) {
    clearTimeout(tryOnTimer);
    tryOnTimer = setTimeout(() => game.tryOn(id), TRY_ON_DELAY_MS);
  }

  function stopTryingOn() {
    clearTimeout(tryOnTimer);
    if (game.previewThemeId !== null) game.tryOn(null);
  }

  /** Shows a theme's flyout after `delay`, or at once while another theme's is open. */
  function showTip(themeId: string, card: HTMLElement, delay: number) {
    clearTimeout(tipTimer);
    if (tip?.id === themeId) return;
    if (delay === 0 || tip) tip = { id: themeId, card };
    else tipTimer = setTimeout(() => (tip = { id: themeId, card }), delay);
  }

  function hideTip(delay = 0) {
    clearTimeout(tipTimer);
    if (delay === 0) tip = null;
    else tipTimer = setTimeout(() => (tip = null), delay);
  }

  function focusTip(event: FocusEvent & { currentTarget: HTMLInputElement }, themeId: string) {
    const card = event.currentTarget.closest("label");
    if (card && (viaKeys || event.currentTarget.matches(":focus-visible"))) {
      showTip(themeId, card, 0);
      clearTimeout(tryOnTimer);
      game.tryOn(themeId);
    }
  }

  /** Arrow keys step through the cards in reading order. */
  const ARROW_STEPS: Readonly<Record<string, 1 | -1>> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };

  /**
   * Arrow keys move between cards and try each one on without choosing it,
   * unlike a plain radio group; Space or Enter chooses. Escape closes an open
   * flyout, and drops a try-on, before it closes the dialog.
   */
  function onThemeKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    viaKeys = true;
    const step = ARROW_STEPS[event.key];
    if (step) {
      event.preventDefault();
      const radios = [...(gallery?.querySelectorAll<HTMLInputElement>("input[name=theme]") ?? [])];
      const at = radios.indexOf(event.currentTarget);
      radios[(at + step + radios.length) % radios.length]?.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      draft.theme = event.currentTarget.value;
      return;
    }
    if (event.key !== "Escape" || (!tip && game.previewThemeId === null)) return;
    event.preventDefault();
    event.stopPropagation();
    hideTip();
    stopTryingOn();
  }
</script>

<div class="bar">
  <input
    type="search"
    class="search"
    aria-label={t("settings.themesSearch", { count: game.themes.length })}
    placeholder={t("settings.themesSearch", { count: game.themes.length })}
    bind:value={query}
  />
  <div class="chips" role="group" aria-label={t("settings.themesShow")}>
    {#each sources as chip (chip.value)}
      <button
        type="button"
        class="chip"
        aria-pressed={source === chip.value}
        onclick={() => (source = chip.value)}>{t(chip.label)}</button
      >
    {/each}
  </div>
  <div class="chips" role="group" aria-label={t("settings.themesMode")}>
    {#each MODES as chip (chip.value)}
      <button
        type="button"
        class="chip"
        aria-pressed={mode === chip.value}
        onclick={() => (mode = mode === chip.value ? null : chip.value)}>{t(chip.label)}</button
      >
    {/each}
  </div>
  <button type="button" class="surprise" disabled={shown.length < 2} onclick={surprise}
    >{t("settings.surprise")}</button
  >
</div>

{#if !filtering && recent.length > 0}
  <h4 class="setting-heading" id="{idPrefix}-recent">{t("settings.themesRecent")}</h4>
  <div class="recent" role="group" aria-labelledby="{idPrefix}-recent">
    {#each recent as entry (entry.id)}
      <button
        type="button"
        class="recent-card"
        aria-pressed={draft.theme === entry.id}
        onclick={() => (draft.theme = entry.id)}
      >
        <ThemePreview board={boardOf(entry)} />
        <span>{entry.sheet.meta.name}</span>
      </button>
    {/each}
  </div>
{/if}

<div class="gallery" bind:this={gallery}>
  {#each sections as section (section.group)}
    <h4 class="setting-heading section">
      {t(GROUP_LABELS[section.group])}
      <span class="count">{formatNumber(section.themes.length)}</span>
    </h4>
    <div class="theme-grid" role="radiogroup" aria-label={t(GROUP_LABELS[section.group])}>
      {#each section.themes as theme (theme.id)}
        {@const place = section.group === "editor" && !filtering ? editorPlacement(theme.id) : null}
        <div
          class="card"
          style:grid-row={place ? place.row + 1 : null}
          style:grid-column={place ? place.column + 1 : null}
        >
          <label
            class="theme"
            class:on={draft.theme === theme.id}
            onpointerdown={() => (viaKeys = false)}
            onpointerenter={(e) => {
              showTip(theme.id, e.currentTarget, TIP_DELAY_MS);
              tryOnLater(theme.id);
            }}
            onpointerleave={() => hideTip(TIP_GRACE_MS)}
          >
            <input
              type="radio"
              name="theme"
              value={theme.id}
              aria-labelledby="{idPrefix}-name-{theme.id}"
              aria-describedby="{idPrefix}-theme-{theme.id}"
              bind:group={draft.theme}
              onfocus={(e) => focusTip(e, theme.id)}
              onblur={() => hideTip()}
              onkeydown={onThemeKeydown}
            />
            {#if theme.preview}
              <img class="preview picture" src={theme.preview} alt="" />
            {:else}
              <ThemePreview board={boardOf(theme)} />
            {/if}
            <span class="theme-name" id="{idPrefix}-name-{theme.id}">{theme.sheet.meta.name}</span>
            <span class="theme-line">{theme.sheet.meta.description}</span>
          </label>
          <button
            type="button"
            class="star"
            aria-label={t("settings.favorite", { name: theme.sheet.meta.name })}
            aria-pressed={draft.favoriteThemes.includes(theme.id)}
            onclick={() => toggleFavorite(theme.id)}
          >
            <Icon name="star" size={16} />
          </button>
        </div>
        <Flyout
          id="{idPrefix}-tip-{theme.id}"
          anchor={tip?.id === theme.id ? tip.card : null}
          {bounds}
          onpointerenter={() => clearTimeout(tipTimer)}
          onpointerleave={() => hideTip(TIP_GRACE_MS)}
        >
          <strong class="tip-name">{theme.sheet.meta.name}</strong>
          <span class="tip-line" id="{idPrefix}-theme-{theme.id}"
            >{theme.sheet.meta.description}</span
          >
          <span class="tip-line tip-author"
            >{t("settings.themeAuthor", { author: theme.sheet.meta.author })}</span
          >
        </Flyout>
      {/each}
    </div>
  {:else}
    <p class="none">{t("settings.themesNone")}</p>
  {/each}
</div>

<div class="foot">
  <label class="rotation">
    <span>{t("settings.rotation")}</span>
    <select bind:value={draft.themeRotation}>
      {#each ROTATIONS as rotation (rotation.value)}
        <option value={rotation.value}>{t(rotation.label)}</option>
      {/each}
    </select>
  </label>
  <button type="button" class="folder" onclick={() => void game.openThemesFolder()}
    >{t("settings.openThemes")}</button
  >
</div>

{#if game.library.skipped.length > 0}
  <ul class="skipped" aria-label={t("settings.skippedThemes")}>
    {#each game.library.skipped as skipped (skipped.id)}
      <li>{t("settings.themeSkipped", { id: skipped.id, reason: skipped.reason })}</li>
    {/each}
  </ul>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-bottom: 4px;
  }

  .search {
    flex: 1 1 200px;
    min-width: 0;
  }

  .chips {
    display: flex;
    gap: 4px;
  }

  .chip {
    min-height: 28px;
    padding: 0 12px;
    border-radius: 14px;
    font-size: var(--font-caption);
  }

  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: transparent;
    color: var(--on-accent);
  }

  .surprise {
    margin-inline-start: auto;
  }

  .recent {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .recent-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-height: 0;
    padding: 4px;
    border-radius: var(--radius-lg);
    font-size: var(--font-caption);
    font-weight: 600;
  }

  .recent-card[aria-pressed="true"] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* Inset, since a card clips whatever paints outside it. */
  .theme.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .section .count {
    margin-inline-start: 4px;
    color: var(--text-dim);
    font-weight: 400;
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  /* Off-screen cards skip layout and painting, so the grid stays quick at any length. */
  .card {
    position: relative;
    content-visibility: auto;
    contain-intrinsic-size: auto 150px;
  }

  .theme {
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 100%;
    padding: 4px 4px 8px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--stroke);
    background: var(--control);
    cursor: default;
  }

  .theme:hover {
    background: var(--control-hover);
  }

  .theme:has(input:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: -4px;
  }

  :global(.platform-macos) .theme:has(input:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: -4px;
  }

  .theme input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .theme :global(.preview) {
    height: 92px;
  }

  .preview.picture {
    display: block;
    width: 100%;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .theme-name {
    margin: 4px 4px 0;
    font-weight: 600;
  }

  .theme-line {
    margin: 0 4px;
    overflow: hidden;
    color: var(--text-dim);
    font-size: var(--font-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .star {
    position: absolute;
    top: 8px;
    inset-inline-end: 8px;
    min-height: 0;
    padding: 3px;
    border: none;
    border-radius: 50%;
    background: var(--layer);
    color: var(--text-dim);
  }

  .star[aria-pressed="true"] {
    color: var(--accent);
  }

  .star[aria-pressed="true"] :global(path) {
    fill: currentColor;
  }

  .none {
    margin: 24px 0;
    color: var(--text-dim);
    text-align: center;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  }

  .rotation {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /*
   * A text link. The accent can fall below 4.5:1 on the surface at caption
   * size, so the link takes the text color.
   */
  .folder {
    min-height: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: var(--font-caption);
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }

  .folder:hover:not(:disabled) {
    background: none;
    color: var(--text-dim);
  }

  .tip-name {
    display: block;
    font-weight: 600;
  }

  .tip-line {
    display: block;
    color: var(--text-dim);
  }

  .tip-author {
    margin-top: 4px;
  }

  .skipped {
    margin: 8px 2px 0;
    padding: 0;
    list-style: none;
    color: var(--text-dim);
    font-size: var(--font-caption);
    user-select: text;
  }
</style>
