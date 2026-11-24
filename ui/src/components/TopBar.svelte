<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { fade } from "svelte/transition";
  import type { Rules } from "../lib/bindings";
  import { formatClock, formatDuration, formatPercent } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import { LEVELS, TILINGS } from "../lib/menu";
  import { platform, prefersReducedMotion, shortcut } from "../lib/platform.svelte";
  import FigureButton from "./FigureButton.svelte";
  import Icon from "./Icon.svelte";
  import LevelTile from "./LevelTile.svelte";
  import MenuButton, { type MenuEntry } from "./MenuButton.svelte";
  import TilingTile from "./TilingTile.svelte";
  import WindowControls from "./WindowControls.svelte";

  let {
    onCustomLevel,
    onSaves,
    onStats,
    onSettings,
    onAbout,
  }: {
    onCustomLevel: () => void;
    onSaves: () => void;
    onStats: () => void;
    onSettings: () => void;
    onAbout: () => void;
  } = $props();

  const isMac = $derived(platform() === "macos");
  const isWindows = $derived(platform() === "windows");
  // On macOS and Windows the toolbar is the title bar, so it drags the window.
  const drag = $derived(isMac || isWindows ? "" : undefined);

  const LEVEL_PREFIX = "level:";

  const pickerEntries: MenuEntry[] = $derived([
    { kind: "header", label: t("picker.level") },
    {
      kind: "grid",
      label: t("picker.level"),
      columns: 5,
      items: [
        ...LEVELS.map((id) => ({
          id: `${LEVEL_PREFIX}${id}`,
          label: t(`level.${id}`),
          checked: game.level === id,
          onSelect: () => void game.newGame(game.tiling, id),
        })),
        {
          id: `${LEVEL_PREFIX}custom`,
          label: t("level.custom"),
          checked: game.level === "custom",
          onSelect: onCustomLevel,
        },
      ],
    },
    { kind: "separator" },
    { kind: "header", label: t("picker.tiling") },
    {
      kind: "grid",
      label: t("picker.tiling"),
      columns: 6,
      items: TILINGS.map((id) => {
        const complexity = game.previews.find((p) => p.tiling === id)?.complexity;
        return {
          id,
          label: t(`tiling.${id}`),
          ...(complexity ? { description: t("picker.complexity", { n: complexity }) } : {}),
          checked: game.tiling === id,
          onSelect: () => void game.newGame(id),
        };
      }),
    },
  ]);

  function toggleRule(rule: keyof Rules) {
    const settings = game.settings;
    if (!settings) return;
    void game.updateSettings({
      ...settings,
      rules: { ...settings.rules, [rule]: !settings.rules[rule] },
    });
  }

  /** A player picker, once there's more than one player to pick. */
  const playerEntries: MenuEntry[] = $derived.by(() => {
    const settings = game.settings;
    if (!settings || settings.profiles.length < 2) return [];
    return [
      { kind: "header", label: t("menu.player") },
      ...settings.profiles.map((player): MenuEntry => ({
        kind: "check",
        label: player,
        checked: player === settings.playerName,
        onSelect: () => void game.updateSettings({ ...settings, playerName: player }),
      })),
      { kind: "separator" },
    ];
  });

  const overflowEntries: MenuEntry[] = $derived([
    {
      kind: "action",
      label: t("menu.newGame"),
      shortcut: shortcut("N", { mod: true }),
      onSelect: () => void game.newGame(),
    },
    {
      kind: "action",
      label: t("menu.saves"),
      shortcut: shortcut("S", { mod: true }),
      onSelect: onSaves,
    },
    { kind: "separator" },
    { kind: "action", label: t("menu.statistics"), onSelect: onStats },
    {
      kind: "action",
      label: t("menu.settings"),
      shortcut: shortcut(",", { mod: true }),
      onSelect: onSettings,
    },
    { kind: "separator" },
    ...playerEntries,
    {
      kind: "check",
      label: t("menu.smartClick"),
      checked: game.settings?.rules.smartClick ?? true,
      onSelect: () => toggleRule("smartClick"),
    },
    {
      kind: "check",
      label: t("menu.questionMarks"),
      checked: game.settings?.rules.questionMarks ?? true,
      onSelect: () => toggleRule("questionMarks"),
    },
    { kind: "separator" },
    { kind: "action", label: t("menu.about"), onSelect: onAbout },
    ...(isMac
      ? []
      : ([
          { kind: "separator" },
          {
            kind: "action",
            label: t("menu.exit"),
            onSelect: () => void getCurrentWindow().close(),
          },
        ] satisfies MenuEntry[])),
  ]);

  const over = $derived(game.gameOver);
  const newGameTitle = $derived(`${t("bar.newGame")} (${shortcut("N", { mod: true })})`);
  const resultDelay = $derived(
    prefersReducedMotion() ? 0 : over?.record.outcome === "won" ? 400 : 900,
  );
</script>

<header class="toolbar" data-tauri-drag-region={drag}>
  <div class="start" data-tauri-drag-region={drag}>
    <MenuButton entries={pickerEntries} label={t("picker.label")}>
      <span class="picker-text">{t(`tiling.${game.tiling}`)} · {t(`level.${game.level}`)}</span>
      <Icon name="chevron" size={14} />
      {#snippet tile(id)}
        {#if id.startsWith(LEVEL_PREFIX)}
          {@const level = id.slice(LEVEL_PREFIX.length)}
          <LevelTile mines={level === "custom" ? null : LEVELS.indexOf(level as never) + 1} />
        {:else}
          <TilingTile {id} />
        {/if}
      {/snippet}
    </MenuButton>
  </div>

  <div class="center" data-tauri-drag-region={drag}>
    {#if over}
      {#key over.record.finishedAt}
        <button
          class="result {over.record.outcome}"
          title={newGameTitle}
          onclick={() => void game.newGame()}
          in:fade|global={{ delay: resultDelay, duration: 180 }}
        >
          <span class="sr-only">{t("bar.newGame")}</span>
          <Icon name={over.record.outcome === "won" ? "eyeWin" : "eyeLost"} size={20} />
          <span class="result-text">
            <strong>
              {over.record.outcome === "won"
                ? t("over.won", { time: formatDuration(over.record.durationMs) })
                : t("over.lost", {
                    percent: formatPercent(
                      (over.record.opened * 100) / Math.max(1, over.record.safeCells),
                    ),
                  })}
            </strong>
            {#if over.championRank}
              <span class="sub record">{t("over.champion", { rank: over.championRank })}</span>
            {:else if over.record.assisted}
              <span class="sub">{t("over.assisted")}</span>
            {/if}
          </span>
          <span class="restart"><Icon name="restart" size={16} /></span>
        </button>
      {/key}
    {:else}
      <FigureButton
        icon="flag"
        hoverIcon="restart"
        action={t("bar.newGame")}
        label={t("bar.flagsLeft")}
        value={game.counters.minesLeft}
        title={newGameTitle}
        negative={game.counters.minesLeft < 0}
        onclick={() => void game.newGame()}
      />
      <FigureButton
        icon={game.paused ? "play" : "clock"}
        hoverIcon={game.paused ? "play" : "pause"}
        action={game.paused ? t("bar.resume") : t("bar.pause")}
        label={t("bar.time")}
        value={formatClock(game.elapsedSeconds * 1000)}
        title={`${game.paused ? t("bar.resume") : t("bar.pause")} (P)`}
        disabled={game.status !== "playing"}
        accent={game.paused}
        onclick={() => void game.togglePause()}
      />
    {/if}
  </div>

  <div class="end" data-tauri-drag-region={drag}>
    <button
      class="icon"
      title={`${t("bar.hint")} (H)`}
      aria-label={t("bar.hint")}
      onclick={() => game.showHint()}
    >
      <Icon name="bulb" size={18} />
    </button>
    <button
      class="icon"
      class:active={game.autoplay}
      title={`${t("bar.autoplay")} (B)`}
      aria-label={t("bar.autoplay")}
      aria-pressed={game.autoplay}
      onclick={() => game.toggleAutoplay()}
    >
      <Icon name="robot" size={18} />
    </button>
    <MenuButton entries={overflowEntries} label={t("menu.more")} variant="icon" align="end">
      <Icon name="more" size={18} />
    </MenuButton>
    {#if isWindows}
      <WindowControls />
    {/if}
  </div>
</header>

<style>
  .toolbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    height: var(--toolbar-height);
    padding: 0 12px;
  }

  /* The window buttons sit flush in the top-right corner, as Windows draws them. */
  :global(.platform-windows) .toolbar {
    padding-right: 0;
  }

  :global(.platform-windows) .end {
    align-self: stretch;
  }

  /*
   * Room for the traffic lights inside the first column, so the side columns
   * stay equal and the center sits on the window's center. AppKit's compact
   * toolbar, from `src-tauri/src/traffic_lights.rs`, puts the close button
   * 12 px from the left edge; this clears the zoom button with a small gap.
   */
  :global(.platform-macos) .start {
    padding-left: 74px;
  }

  .start,
  .end {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .end {
    justify-content: flex-end;
  }

  .picker-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .center {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    min-width: 0;
  }

  /* The result replaces the figures when a game ends and starts the next one.
     The accent square marks it as the place to restart. */
  .result {
    gap: 10px;
    min-width: 0;
    min-height: 36px;
    margin: 0 -10px;
    padding: 0 10px;
    text-align: start;
    background: transparent;
    border-color: transparent;
  }

  .result:hover {
    background: var(--subtle-hover);
  }

  .result:active {
    background: var(--subtle-pressed);
  }

  .result.won {
    color: var(--success);
  }

  .result.lost {
    color: var(--danger);
  }

  .restart {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--control-height);
    height: var(--control-height);
    margin-left: 4px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
  }

  .result:hover .restart {
    background: var(--accent-hover);
  }

  .result-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    color: var(--text);
    min-width: 0;
  }

  .result-text strong {
    font-weight: 600;
    white-space: nowrap;
  }

  .sub {
    font-size: var(--font-caption);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub.record {
    color: var(--warning);
  }

  .icon {
    flex-shrink: 0;
    width: var(--control-height);
    padding: 0;
    background: transparent;
    border-color: transparent;
    color: var(--text);
  }

  .icon:hover:not(:disabled) {
    background: var(--subtle-hover);
  }

  .icon:active:not(:disabled) {
    background: var(--subtle-pressed);
  }

  .icon.active {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
</style>
