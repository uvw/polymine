<script lang="ts">
  import { onMount } from "svelte";
  import type { ColorFilter, Settings, ThemeRotation } from "../lib/bindings";
  import { formatNumber } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import { t, type MessageKey } from "../lib/i18n";
  import { editorPlacement, type ThemeGroup } from "../lib/themes/builtin";
  import { findTheme, themeFor } from "../lib/themes/catalog";
  import { filterTheme } from "../lib/themes/filter";
  import {
    filterThemes,
    gallerySections,
    knownIds,
    pickTheme,
    type ThemeShow,
  } from "../lib/themes/gallery";
  import type { ThemeEntry } from "../lib/themes/types";
  import Icon from "./Icon.svelte";
  import Switch from "./Switch.svelte";
  import ThemePreview from "./ThemePreview.svelte";

  let { draft = $bindable(), idPrefix }: { draft: Settings; idPrefix: string } = $props();

  const GROUP_LABELS: Record<ThemeGroup, MessageKey> = {
    polymine: "settings.themesPolymine",
    editor: "settings.themesEditor",
    player: "settings.themesPlayer",
  };

  const COLOR_FILTERS: readonly { value: ColorFilter; label: MessageKey }[] = [
    { value: "off", label: "settings.colorFilterOff" },
    { value: "deuteranopia", label: "settings.colorFilterDeuteranopia" },
    { value: "protanopia", label: "settings.colorFilterProtanopia" },
    { value: "tritanopia", label: "settings.colorFilterTritanopia" },
  ];

  const ROTATIONS: readonly { value: ThemeRotation; label: MessageKey }[] = [
    { value: "off", label: "settings.rotationOff" },
    { value: "favorites", label: "settings.rotationFavorites" },
    { value: "all", label: "settings.rotationAll" },
  ];

  const CHIPS: readonly { value: ThemeShow; label: MessageKey }[] = [
    { value: "all", label: "settings.themesAll" },
    { value: "recent", label: "settings.themesRecent" },
    { value: "favorites", label: "settings.themesFavorites" },
    { value: "light", label: "settings.themesLight" },
    { value: "dark", label: "settings.themesDark" },
    { value: "mono", label: "settings.themesMono" },
    { value: "seeThrough", label: "settings.themesSeeThrough" },
  ];

  let query = $state("");
  let show = $state<ThemeShow>("all");
  let gallery = $state<HTMLElement>();

  const recent = $derived(knownIds(game.themes, draft.recentThemes));
  const chips = $derived(CHIPS.filter((chip) => chip.value !== "recent" || recent.length > 0));
  const shown = $derived(
    filterThemes(game.themes, { query, show, favorites: draft.favoriteThemes, recent }),
  );
  const sections = $derived(gallerySections(shown));
  const filtering = $derived(query.trim() !== "" || show !== "all");
  const current = $derived(findTheme(game.themes, draft.theme));
  const favorite = (id: string) => draft.favoriteThemes.includes(id);

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
  });

  function toggleFavorite(id: string) {
    draft.favoriteThemes = favorite(id)
      ? draft.favoriteThemes.filter((f) => f !== id)
      : [...draft.favoriteThemes, id];
  }

  function surprise() {
    const id = pickTheme(shown, draft.theme);
    if (id) draft.theme = id;
  }

  /** Arrow keys step through the cards in reading order. */
  const ARROW_STEPS: Readonly<Record<string, 1 | -1>> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };

  /**
   * Arrow keys move between cards without choosing, unlike a plain radio
   * group, since each choice redraws the board. Space or Enter chooses.
   */
  function onThemeKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    const step = ARROW_STEPS[event.key];
    if (step) {
      event.preventDefault();
      const radios = [...(gallery?.querySelectorAll<HTMLInputElement>("input[name=theme]") ?? [])];
      const at = radios.indexOf(event.currentTarget);
      radios[(at + step + radios.length) % radios.length]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      draft.theme = event.currentTarget.value;
    }
  }
</script>

<div class="top">
  <div class="current" role="group" aria-label={t("settings.themesCurrent")}>
    {#if current.preview}
      <img class="preview picture" src={current.preview} alt="" />
    {:else}
      <ThemePreview board={boardOf(current)} />
    {/if}
    <div class="current-name">
      <strong>{current.sheet.meta.name}</strong>
      <button
        type="button"
        class="star"
        aria-label={t("settings.favorite", { name: current.sheet.meta.name })}
        aria-pressed={favorite(current.id)}
        onclick={() => toggleFavorite(current.id)}
      >
        <Icon name="star" size={16} />
      </button>
    </div>
    <p class="current-line">{current.sheet.meta.description}</p>
    <p class="current-line">{t("settings.themeAuthor", { author: current.sheet.meta.author })}</p>
  </div>

  <div class="setting-group options">
    <Switch label={t("settings.accentTint")} bind:checked={draft.accentTint} />
    <Switch
      label={t("settings.countKey")}
      help={t("settings.countKeyHelp")}
      bind:checked={draft.showCountKey}
    />
    <div class="setting-row">
      <span class="setting-text">
        <label for="{idPrefix}-filter">{t("settings.colorFilter")}</label>
        <small id="{idPrefix}-filter-help">{t("settings.colorFilterHelp")}</small>
      </span>
      <select
        id="{idPrefix}-filter"
        aria-describedby="{idPrefix}-filter-help"
        bind:value={draft.colorFilter}
      >
        {#each COLOR_FILTERS as filter (filter.value)}
          <option value={filter.value}>{t(filter.label)}</option>
        {/each}
      </select>
    </div>
    <div class="setting-row">
      <label for="{idPrefix}-rotation">{t("settings.rotation")}</label>
      <select id="{idPrefix}-rotation" bind:value={draft.themeRotation}>
        {#each ROTATIONS as rotation (rotation.value)}
          <option value={rotation.value}>{t(rotation.label)}</option>
        {/each}
      </select>
    </div>
  </div>
</div>

<div class="bar">
  <h4 class="setting-heading">{t("settings.themesHeading")}</h4>
  <input
    type="search"
    class="search"
    aria-label={t("settings.themesSearch", { count: game.themes.length })}
    placeholder={t("settings.themesSearch", { count: game.themes.length })}
    bind:value={query}
  />
  <button type="button" disabled={shown.length < 2} onclick={surprise}
    >{t("settings.surprise")}</button
  >
</div>
<div class="chips" role="group" aria-label={t("settings.themesShow")}>
  {#each chips as chip (chip.value)}
    <button
      type="button"
      class="chip"
      aria-pressed={show === chip.value}
      onclick={() => (show = chip.value)}>{t(chip.label)}</button
    >
  {/each}
</div>

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
          <label class="theme" class:on={draft.theme === theme.id}>
            <input
              type="radio"
              name="theme"
              value={theme.id}
              aria-labelledby="{idPrefix}-name-{theme.id}"
              aria-describedby="{idPrefix}-line-{theme.id}"
              bind:group={draft.theme}
              onkeydown={onThemeKeydown}
            />
            {#if theme.preview}
              <img class="preview picture" src={theme.preview} alt="" />
            {:else}
              <ThemePreview board={boardOf(theme)} />
            {/if}
            {#if draft.theme === theme.id}
              <span class="check" aria-hidden="true"><Icon name="check" size={12} /></span>
            {/if}
            <span class="theme-name">
              <span id="{idPrefix}-name-{theme.id}">{theme.sheet.meta.name}</span>
              {#if favorite(theme.id)}
                <span class="mark" role="img" aria-label={t("settings.favoriteMark")}
                  ><Icon name="star" size={12} /></span
                >
              {/if}
            </span>
            <span class="line" id="{idPrefix}-line-{theme.id}">{theme.sheet.meta.description}</span>
          </label>
        </div>
      {/each}
    </div>
  {:else}
    <p class="none">{t("settings.themesNone")}</p>
  {/each}
</div>

<button type="button" class="folder" onclick={() => void game.openThemesFolder()}
  >{t("settings.openThemes")}</button
>

{#if game.library.skipped.length > 0}
  <ul class="skipped" aria-label={t("settings.skippedThemes")}>
    {#each game.library.skipped as skipped (skipped.id)}
      <li>{t("settings.themeSkipped", { id: skipped.id, reason: skipped.reason })}</li>
    {/each}
  </ul>
{/if}

<style>
  /* The chosen theme, large, beside the options that change how it draws. */
  .top {
    display: grid;
    grid-template-columns: 236px minmax(0, 1fr);
    gap: 16px;
    padding: 12px;
    background: var(--control);
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
  }

  .current {
    min-width: 0;
  }

  .current :global(.preview) {
    height: 132px;
  }

  .current-name {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    font-size: calc(var(--font-size) + 2px);
  }

  .current-line {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: var(--font-caption);
  }

  .star {
    min-height: 0;
    padding: 3px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-dim);
  }

  .star[aria-pressed="true"] {
    color: var(--accent);
  }

  .star[aria-pressed="true"] :global(path),
  .mark :global(path) {
    fill: currentColor;
  }

  /* One list of plain rows, with lines between them, inside the panel's frame. */
  .options {
    gap: 0;
    padding: 0;
    background: none;
    border: none;
  }

  .options > :global(.setting-row) {
    min-height: 44px;
    padding: 6px 0;
    background: none;
    border: none;
    border-radius: 0;
  }

  .options > :global(.setting-row + .setting-row) {
    border-top: 1px solid var(--stroke);
  }

  .options select {
    width: 160px;
    min-width: 0;
    flex: none;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0 8px;
  }

  .bar .setting-heading {
    margin: 0 auto 0 0;
  }

  .search {
    flex: 0 1 220px;
    min-width: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    min-height: 26px;
    padding: 0 12px;
    border-radius: 13px;
    font-size: var(--font-caption);
  }

  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: transparent;
    color: var(--on-accent);
  }

  .section .count {
    margin-inline-start: 4px;
    color: var(--text-dim);
    font-weight: 400;
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  /* Off-screen cards skip layout and painting, so the grid stays quick at any length. */
  .card {
    content-visibility: auto;
    contain-intrinsic-size: auto 100px;
  }

  .theme {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 3px 3px 4px;
    border-radius: var(--radius-lg);
    border: 1px solid transparent;
    cursor: default;
  }

  .theme:hover {
    background: var(--control-hover);
  }

  /* Inset, since a card clips whatever paints outside it. */
  .theme.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .theme:has(input:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }

  :global(.platform-macos) .theme:has(input:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .theme input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .theme :global(.preview) {
    height: 72px;
  }

  .preview.picture {
    display: block;
    width: 100%;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .check {
    position: absolute;
    top: 7px;
    inset-inline-end: 7px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
  }

  .theme-name {
    display: flex;
    align-items: center;
    gap: 3px;
    margin: 4px 2px 0;
    overflow: hidden;
    font-size: var(--font-caption);
    white-space: nowrap;
  }

  .mark {
    display: inline-flex;
    color: var(--accent);
  }

  /* The description stays for screen readers, which read it after the name. */
  .line {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .none {
    margin: 24px 0;
    color: var(--text-dim);
    text-align: center;
  }

  /*
   * A text link. The accent can fall below 4.5:1 on the surface at caption
   * size, so the link takes the text color.
   */
  .folder {
    display: block;
    min-height: 0;
    margin: 16px 0 0 auto;
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

  .skipped {
    margin: 8px 2px 0;
    padding: 0;
    list-style: none;
    color: var(--text-dim);
    font-size: var(--font-caption);
    user-select: text;
  }
</style>
