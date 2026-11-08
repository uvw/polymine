<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { IdleAction, Settings } from "../lib/bindings";
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
  import Icon, { type IconName } from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Switch from "./Switch.svelte";
  import ThemesPane from "./ThemesPane.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  type Pane = "general" | "themes" | "bot";

  const PANES: readonly { id: Pane; label: MessageKey; icon: IconName }[] = [
    { id: "general", label: "settings.general", icon: "gear" },
    { id: "themes", label: "settings.themes", icon: "palette" },
    { id: "bot", label: "settings.assistant", icon: "robot" },
  ];

  const IDLE_ACTIONS: readonly { value: IdleAction; label: MessageKey }[] = [
    { value: "off", label: "settings.idleOff" },
    { value: "hint", label: "settings.idleHint" },
    { value: "autoplay", label: "settings.idleAutoplay" },
  ];

  /** Waits for a slider to settle before saving. */
  const APPLY_DELAY_MS = 250;
  /** Slider readouts stay ungrouped, so 1000 ms doesn't gain a separator mid-drag. */
  const SLIDER_VALUE = { useGrouping: false };

  const id = $props.id();
  let pane = $state<Pane>("general");
  let panel = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let draft = $state<Settings | null>(null);
  let name = $state("");
  /** Bumped on each scroll of the pane, which closes a theme's flyout. */
  let scrolled = $state(0);
  /** The saved settings the draft started from, to tell the player's changes from others'. */
  let base: Settings | null = null;
  $effect(() => {
    if (!open) {
      untrack(flush);
      draft = null;
      game.tryOn(null);
      return;
    }
    if (!untrack(() => draft) && game.settings) {
      draft = structuredClone($state.snapshot(game.settings));
      base = structuredClone($state.snapshot(game.settings));
      name = draft.playerName;
      void game.reloadThemes();
      // The dialog opens before its content renders, so focus would land on the dialog itself.
      void tick().then(() => document.getElementById(`${id}-tab-${untrack(() => pane)}`)?.focus());
    }
  });

  // Changes apply as they're made. Only the draft is tracked: the saved
  // settings come back normalized, and must not trigger another save.
  // Settings can change while the dialog is open: a new game rotates the theme,
  // and the shell keeps the recent list. Fields the player hasn't touched follow
  // them, so a save from here doesn't put the old values back.
  $effect(() => {
    const saved = game.settings;
    if (!saved) return;
    const next: Settings = structuredClone($state.snapshot(saved));
    untrack(() => {
      if (!draft || !base) return;
      const from = base;
      const fields = draft as Record<keyof Settings, unknown>;
      for (const key of Object.keys(next) as (keyof Settings)[]) {
        if (JSON.stringify(fields[key]) === JSON.stringify(from[key])) fields[key] = next[key];
      }
      base = next;
    });
  });

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

  function show(next: Pane) {
    pane = next;
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
        onscroll={() => scrolled++}
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
        {:else if pane === "themes"}
          <ThemesPane bind:draft idPrefix={id} bounds={root} {scrolled} />
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
</style>
