<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { ColorFilter, IdleAction, Settings } from "../lib/bindings";
  import { formatNumber } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import {
    LANGUAGES,
    language,
    languageName,
    resolveLanguage,
    t,
    type MessageKey,
  } from "../lib/i18n";
  import { themeGroup, type ThemeGroup } from "../lib/themes/builtin";
  import { findTheme, themeFor } from "../lib/themes/catalog";
  import { cssColor as hex } from "../lib/themes/color";
  import { filterTheme } from "../lib/themes/filter";
  import { previewLight } from "../lib/themes/gloss";
  import Flyout from "./Flyout.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Switch from "./Switch.svelte";
  import Tabs from "./Tabs.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  type Pane = "general" | "appearance" | "bot";

  const PANES: readonly { id: Pane; label: MessageKey; icon: IconName }[] = [
    { id: "general", label: "settings.general", icon: "gear" },
    { id: "appearance", label: "settings.appearance", icon: "palette" },
    { id: "bot", label: "settings.assistant", icon: "robot" },
  ];

  const COLOR_FILTERS: readonly { value: ColorFilter; label: MessageKey }[] = [
    { value: "off", label: "settings.colorFilterOff" },
    { value: "deuteranopia", label: "settings.colorFilterDeuteranopia" },
    { value: "protanopia", label: "settings.colorFilterProtanopia" },
    { value: "tritanopia", label: "settings.colorFilterTritanopia" },
  ];

  const IDLE_ACTIONS: readonly { value: IdleAction; label: MessageKey }[] = [
    { value: "off", label: "settings.idleOff" },
    { value: "hint", label: "settings.idleHint" },
    { value: "autoplay", label: "settings.idleAutoplay" },
  ];

  /** Theme tabs in order. The player's tab shows only when the themes folder holds a theme. */
  const THEME_GROUPS: readonly { id: ThemeGroup; label: MessageKey }[] = [
    { id: "polymine", label: "settings.themesPolymine" },
    { id: "editor", label: "settings.themesEditor" },
    { id: "player", label: "settings.themesPlayer" },
  ];

  /** Cells in a theme preview: a closed tile, a count, or a flag. */
  const PREVIEW: readonly ("closed" | "flag" | number)[] = [
    "closed",
    1,
    2,
    1,
    "closed",
    "flag",
    3,
    0,
    2,
    "closed",
  ];

  /** Waits for a slider to settle before saving. */
  const APPLY_DELAY_MS = 250;
  /** How long the pointer rests on a theme before its flyout shows. */
  const TIP_DELAY_MS = 500;
  /** Lets the pointer cross from a theme to its flyout, so the flyout's text can be selected. */
  const TIP_GRACE_MS = 150;
  /** Slider readouts stay ungrouped, so 1000 ms doesn't gain a separator mid-drag. */
  const SLIDER_VALUE = { useGrouping: false };

  const id = $props.id();
  let pane = $state<Pane>("general");
  let panel = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let draft = $state<Settings | null>(null);
  let name = $state("");
  /** The theme whose flyout shows, and the card it points at. */
  let tip = $state<{ id: string; card: HTMLElement } | null>(null);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  let chosenGroup = $state<ThemeGroup>("polymine");

  const themeTabs = $derived(
    THEME_GROUPS.filter((g) => game.themes.some((theme) => themeGroup(theme) === g.id)).map(
      (g) => ({ id: g.id, label: t(g.label) }),
    ),
  );
  const group = $derived(
    themeTabs.some((tab) => tab.id === chosenGroup) ? chosenGroup : "polymine",
  );
  const groupThemes = $derived(game.themes.filter((theme) => themeGroup(theme) === group));

  /** Previews resolve as the board does, with the accent while the tint is on. */
  const previewEnv = $derived({
    accent: draft?.accentTint === false ? null : game.accent,
    dark: game.themeEnv.dark,
  });

  $effect(() => {
    if (!open) {
      untrack(flush);
      draft = null;
      hideTip();
      return;
    }
    if (!untrack(() => draft) && game.settings) {
      draft = structuredClone($state.snapshot(game.settings));
      name = draft.playerName;
      chosenGroup = themeGroup(findTheme(game.themes, draft.theme));
      void game.reloadThemes();
      // The dialog opens before its content renders, so focus would land on the dialog itself.
      void tick().then(() => document.getElementById(`${id}-tab-${untrack(() => pane)}`)?.focus());
    }
  });

  // Changes apply as they're made. Only the draft is tracked: the saved
  // settings come back normalized, and must not trigger another save.
  $effect(() => {
    if (!draft) return;
    const next = $state.snapshot(draft);
    const timer = setTimeout(() => {
      if (JSON.stringify(next) !== JSON.stringify(untrack(() => game.settings))) {
        void game.updateSettings(next);
      }
    }, APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  });

  /** Saves the language and reloads, since strings on screen don't switch. */
  async function chooseLanguage(code: string) {
    if (!draft || draft.language === code) return;
    draft.language = code;
    await game.updateSettings($state.snapshot(draft));
    if (resolveLanguage(code) !== language()) location.reload();
  }

  /** The name renames the active player when the field is left, not on every keystroke. */
  function commitName() {
    if (!draft) return;
    const next = name.trim();
    const current = draft.playerName;
    if (next === "" || next === current) return;
    // A name another player already has merges the two.
    draft.profiles = draft.profiles.includes(next)
      ? draft.profiles.filter((p) => p !== current)
      : draft.profiles.map((p) => (p === current ? next : p));
    draft.playerName = next;
  }

  function choosePlayer(player: string) {
    if (!draft) return;
    commitName();
    draft.playerName = player;
    name = player;
  }

  /** Adds a player with a placeholder name and puts the name field in reach to change it. */
  async function addPlayer() {
    if (!draft) return;
    commitName();
    let n = draft.profiles.length + 1;
    while (draft.profiles.includes(t("settings.newPlayer", { n }))) n++;
    const player = t("settings.newPlayer", { n });
    draft.profiles = [...draft.profiles, player];
    choosePlayer(player);
    await tick();
    const field = document.getElementById(`${id}-player`) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }

  /** Removes the active player from the list. Their games stay in the history. */
  function removePlayer() {
    if (!draft || draft.profiles.length < 2) return;
    commitName();
    const index = draft.profiles.indexOf(draft.playerName);
    const rest = draft.profiles.filter((p) => p !== draft?.playerName);
    draft.profiles = rest;
    choosePlayer(rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? rest[0] ?? "");
  }

  /** Saves what closing would otherwise drop: the name being typed and a save still waiting. */
  function flush() {
    if (!draft) return;
    commitName();
    const next = $state.snapshot(draft);
    if (JSON.stringify(next) !== JSON.stringify(game.settings)) void game.updateSettings(next);
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
    if (card && event.currentTarget.matches(":focus-visible")) showTip(themeId, card, 0);
  }

  /** Escape closes an open flyout before it closes the dialog. */
  function onThemeKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !tip) return;
    event.preventDefault();
    event.stopPropagation();
    hideTip();
  }

  function show(next: Pane) {
    pane = next;
    hideTip();
    if (panel) panel.scrollTop = 0;
  }

  /** Arrow keys, Home, and End move between sections, as in a vertical tab list. */
  async function onTabKeydown(event: KeyboardEvent) {
    const index = PANES.findIndex((p) => p.id === pane);
    const last = PANES.length - 1;
    const target = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const next = target === undefined ? undefined : PANES[target];
    if (!next) return;
    event.preventDefault();
    show(next.id);
    await tick();
    document.getElementById(`${id}-tab-${next.id}`)?.focus();
  }
</script>

<Modal title={t("settings.title")} bind:open wide fixed>
  {#if draft}
    <div class="settings" bind:this={root}>
      <div
        class="sidebar"
        role="tablist"
        aria-orientation="vertical"
        aria-label={t("settings.sections")}
      >
        {#each PANES as p (p.id)}
          <button
            type="button"
            role="tab"
            id="{id}-tab-{p.id}"
            aria-selected={pane === p.id}
            aria-controls="{id}-panel"
            tabindex={pane === p.id ? 0 : -1}
            onclick={() => show(p.id)}
            onkeydown={onTabKeydown}
          >
            <Icon name={p.icon} size={16} />
            {t(p.label)}
          </button>
        {/each}
      </div>

      <div
        class="panel"
        role="tabpanel"
        id="{id}-panel"
        aria-labelledby="{id}-tab-{pane}"
        bind:this={panel}
        onscroll={() => hideTip()}
      >
        {#if pane === "general"}
          <div class="setting-group">
            <div class="setting-row">
              <span class="setting-text">
                <label for="{id}-profile">{t("settings.player")}</label>
                <small id="{id}-profile-help">{t("settings.profileHelp")}</small>
              </span>
              <span class="buttons">
                <select
                  id="{id}-profile"
                  aria-describedby="{id}-profile-help"
                  value={draft.playerName}
                  onchange={(e) => choosePlayer(e.currentTarget.value)}
                >
                  {#each draft.profiles as player (player)}
                    <option value={player}>{player}</option>
                  {/each}
                </select>
                <button onclick={() => void addPlayer()}>{t("settings.addPlayer")}</button>
                <button
                  title={t("settings.removePlayerHelp")}
                  onclick={removePlayer}
                  disabled={draft.profiles.length < 2}
                >
                  {t("settings.removePlayer")}
                </button>
              </span>
            </div>
            <div class="setting-row">
              <span class="setting-text">
                <label for="{id}-player">{t("settings.playerName")}</label>
                <small id="{id}-player-help">{t("settings.playerHelp")}</small>
              </span>
              <input
                id="{id}-player"
                type="text"
                maxlength="40"
                aria-describedby="{id}-player-help"
                bind:value={name}
                onchange={commitName}
                onblur={() => {
                  if (draft && name.trim() === "") name = draft.playerName;
                }}
              />
            </div>
            <div class="setting-row">
              <label for="{id}-language">{t("settings.language")}</label>
              <select
                id="{id}-language"
                value={draft.language}
                onchange={(e) => void chooseLanguage(e.currentTarget.value)}
              >
                {#each ["system", ...LANGUAGES] as code (code)}
                  <option value={code}>
                    {code === "system"
                      ? t("settings.languageSystem", {
                          language: languageName(resolveLanguage("system")),
                        })
                      : languageName(code)}
                  </option>
                {/each}
              </select>
            </div>
          </div>

          <h4 class="setting-heading">{t("settings.rules")}</h4>
          <div class="setting-group">
            <Switch
              label={t("settings.smartClick")}
              help={t("settings.smartClickHelp")}
              bind:checked={draft.rules.smartClick}
            />
            <Switch
              label={t("settings.questionMarks")}
              help={t("settings.questionMarksHelp")}
              bind:checked={draft.rules.questionMarks}
            />
          </div>

          <h4 class="setting-heading">{t("settings.window")}</h4>
          <div class="setting-group">
            <Switch label={t("settings.pauseOnFocusLoss")} bind:checked={draft.pauseOnFocusLoss} />
            <Switch label={t("settings.fillWindow")} bind:checked={draft.fillWindow} />
            <Switch label={t("settings.hideToolbar")} bind:checked={draft.hideToolbar} />
          </div>
        {:else if pane === "appearance"}
          <div class="theme-bar">
            <div class="theme-tabs">
              <Tabs
                label={t("settings.themeGroups")}
                tabs={themeTabs}
                value={group}
                idPrefix="{id}-group"
                panel="{id}-themes"
                onselect={(next) => {
                  chosenGroup = next;
                  hideTip();
                }}
              />
            </div>
            <button type="button" class="folder" onclick={() => void game.openThemesFolder()}
              >{t("settings.openThemes")}</button
            >
          </div>
          <div class="themes" id="{id}-themes" role="tabpanel" aria-labelledby="{id}-group-{group}">
            <div class="theme-grid" role="radiogroup" aria-label={t("settings.theme")}>
              {#each groupThemes as theme (theme.id)}
                {@const b = filterTheme(themeFor(theme, previewEnv), draft.colorFilter).board}
                <label
                  class="theme"
                  class:on={draft.theme === theme.id}
                  onpointerenter={(e) => showTip(theme.id, e.currentTarget, TIP_DELAY_MS)}
                  onpointerleave={() => hideTip(TIP_GRACE_MS)}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme.id}
                    aria-describedby="{id}-theme-{theme.id}"
                    bind:group={draft.theme}
                    onfocus={(e) => focusTip(e, theme.id)}
                    onblur={() => hideTip()}
                    onkeydown={onThemeKeydown}
                  />
                  {#if theme.preview}
                    <img class="preview picture" src={theme.preview} alt="" />
                  {:else}
                    <span
                      class="preview"
                      style:background={b.plate === null ? "var(--glass-preview)" : hex(b.plate)}
                      aria-hidden="true"
                    >
                      {#each PREVIEW as cell, i (i)}
                        {#if cell === "closed" || cell === "flag"}
                          <i
                            style:background={hex(b.closed)}
                            style:background-image={previewLight(b, "closed")}
                            style:color={hex(b.flag)}>{cell === "flag" ? "⚑" : ""}</i
                          >
                        {:else if cell > 0 && b.numberStyle === "colors"}
                          <i style:background={hex(b.numbers[cell - 1] ?? b.open)}></i>
                        {:else}
                          <i
                            style:background={hex(b.open)}
                            style:background-image={previewLight(b, "open")}
                            style:color={hex(b.numbers[cell - 1] ?? 0)}>{cell > 0 ? cell : ""}</i
                          >
                        {/if}
                      {/each}
                    </span>
                  {/if}
                  <span class="theme-name">{theme.sheet.meta.name}</span>
                </label>
                <Flyout
                  id="{id}-tip-{theme.id}"
                  anchor={tip?.id === theme.id ? tip.card : null}
                  bounds={root}
                  onpointerenter={() => clearTimeout(tipTimer)}
                  onpointerleave={() => hideTip(TIP_GRACE_MS)}
                >
                  <strong class="tip-name">{theme.sheet.meta.name}</strong>
                  <span class="tip-line" id="{id}-theme-{theme.id}"
                    >{theme.sheet.meta.description}</span
                  >
                  <span class="tip-line tip-author"
                    >{t("settings.themeAuthor", { author: theme.sheet.meta.author })}</span
                  >
                </Flyout>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <Switch label={t("settings.accentTint")} bind:checked={draft.accentTint} />
            <div class="setting-row">
              <span class="setting-text">
                <label for="{id}-filter">{t("settings.colorFilter")}</label>
                <small id="{id}-filter-help">{t("settings.colorFilterHelp")}</small>
              </span>
              <select
                id="{id}-filter"
                class="fit"
                aria-describedby="{id}-filter-help"
                bind:value={draft.colorFilter}
              >
                {#each COLOR_FILTERS as filter (filter.value)}
                  <option value={filter.value}>{t(filter.label)}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if game.library.skipped.length > 0}
            <ul class="skipped" aria-label={t("settings.skippedThemes")}>
              {#each game.library.skipped as skipped (skipped.id)}
                <li>{t("settings.themeSkipped", { id: skipped.id, reason: skipped.reason })}</li>
              {/each}
            </ul>
          {/if}
        {:else if pane === "bot"}
          <div class="setting-group">
            <div class="setting-row">
              <label for="{id}-delay">{t("settings.moveDelay")}</label>
              <span class="slider">
                <input
                  id="{id}-delay"
                  type="range"
                  min="0"
                  max="1000"
                  step="20"
                  bind:value={draft.assistant.moveDelayMs}
                />
                <output for="{id}-delay"
                  >{t("settings.moveDelayValue", {
                    ms: formatNumber(draft.assistant.moveDelayMs, SLIDER_VALUE),
                  })}</output
                >
              </span>
            </div>
            <div class="setting-row">
              <label for="{id}-idle">{t("settings.idle")}</label>
              <select id="{id}-idle" bind:value={draft.assistant.idleAction}>
                {#each IDLE_ACTIONS as action (action.value)}
                  <option value={action.value}>{t(action.label)}</option>
                {/each}
              </select>
            </div>
            <div class="setting-row" class:disabled={draft.assistant.idleAction === "off"}>
              <label for="{id}-idle-time">{t("settings.idleSeconds")}</label>
              <span class="slider">
                <input
                  id="{id}-idle-time"
                  type="range"
                  min="5"
                  max="120"
                  step="5"
                  disabled={draft.assistant.idleAction === "off"}
                  bind:value={draft.assistant.idleSeconds}
                />
                <output for="{id}-idle-time"
                  >{t("settings.idleSecondsValue", {
                    seconds: formatNumber(draft.assistant.idleSeconds, SLIDER_VALUE),
                  })}</output
                >
              </span>
            </div>
          </div>

          <div class="setting-group spaced">
            <Switch
              label={t("settings.stopWhenUncertain")}
              bind:checked={draft.assistant.stopWhenUncertain}
            />
            <Switch
              label={t("settings.autostart")}
              bind:checked={draft.assistant.autostartNextGame}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <button class="primary" onclick={() => (open = false)}>{t("settings.done")}</button>
  {/snippet}
</Modal>

<style>
  .settings {
    display: grid;
    grid-template-columns: 176px 1fr;
    height: 100%;
    border-top: 1px solid var(--divider);
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 8px;
    overflow: auto;
  }

  .sidebar button {
    position: relative;
    justify-content: flex-start;
    gap: 10px;
    min-height: 36px;
    padding: 0 12px;
    background: none;
    border: none;
    color: var(--text);
    text-align: start;
  }

  .sidebar button:hover {
    background: var(--subtle-hover);
  }

  .sidebar button[aria-selected="true"] {
    background: var(--subtle-hover);
  }

  /* Fluent marks the current page with a short accent pill. */
  .sidebar button[aria-selected="true"]::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 50%;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: var(--accent);
    transform: translateY(-50%);
  }

  :global(.platform-macos) .sidebar {
    padding: 10px;
    background: color-mix(in srgb, var(--window) 50%, var(--surface));
    border-inline-end: 1px solid var(--divider);
  }

  :global(.platform-macos) .sidebar button {
    min-height: 28px;
    padding: 0 8px;
    gap: 8px;
  }

  :global(.platform-macos) .sidebar button[aria-selected="true"] {
    background: var(--accent);
    color: var(--on-accent);
  }

  :global(.platform-macos) .sidebar button[aria-selected="true"]::before {
    content: none;
  }

  /* The sidebar names the section, so the pane starts with its settings. */
  .panel {
    min-width: 0;
    padding: 16px 24px 12px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .spaced {
    margin-top: 16px;
  }

  /* Fluent puts the tabs at the start; macOS centers its segmented control. */
  .theme-bar {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
  }

  :global(.platform-macos) .theme-bar {
    grid-template-columns: 1fr auto 1fr;
  }

  :global(.platform-macos) .theme-tabs {
    grid-column: 2;
  }

  /*
   * A text link, so the row keeps the tabs' height. The accent can fall below
   * 4.5:1 on the surface at caption size, so the link takes the text color.
   */
  .folder {
    justify-self: end;
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

  .themes {
    margin: 8px 0 12px;
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 6px;
  }

  .theme {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--stroke);
    background: var(--control);
    cursor: default;
  }

  .theme:hover {
    background: var(--control-hover);
  }

  .theme.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .theme:has(input:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }

  :global(.platform-macos) .theme:has(input:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: 1px;
  }

  .theme input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .preview {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius);
  }

  .preview.picture {
    display: block;
    width: 100%;
    /* The drawn preview's height: two 16 px rows, a gap, and the padding. */
    height: 40px;
    padding: 0;
    object-fit: cover;
  }

  .preview i {
    display: grid;
    place-items: center;
    height: 16px;
    border-radius: 2px;
    font-style: normal;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .theme-name {
    /* Room for two lines on every card, so the settings below the grid stay
       put when the tabs switch between short and long names. */
    display: grid;
    place-items: center;
    min-height: calc(2 * 1.25em + 2px);
    padding: 0 2px 2px;
    font-size: var(--font-caption);
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    text-wrap: balance;
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

  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider input {
    width: 160px;
  }

  output {
    min-width: 52px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .setting-row.disabled label,
  .setting-row.disabled .slider {
    opacity: 0.45;
  }

  .setting-row .buttons {
    display: flex;
    flex: none;
    gap: 8px;
  }

  .setting-row .buttons select {
    width: 140px;
  }

  .setting-row select,
  .setting-row input[type="text"] {
    width: 200px;
    flex: none;
  }

  /* Wide enough for its longest option, such as "Deuteranopia (red-green)". */
  .setting-row select.fit {
    width: auto;
    min-width: 200px;
  }
</style>
