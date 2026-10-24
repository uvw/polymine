<script lang="ts" module>
  import type { Level } from "../lib/bindings";
  import type { TilingId } from "../lib/bindings";

  /** A champions row to open on and mark, after a new record. */
  export interface ChampionHighlight {
    tiling: TilingId;
    level: Level;
    rank: number;
  }
</script>

<script lang="ts">
  import { api } from "../lib/api";
  import type { StatsView } from "../lib/bindings";
  import { formatDate, formatDuration, formatNumber, formatPercent } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import { LEVELS, TILINGS } from "../lib/menu";
  import Icon from "./Icon.svelte";
  import MenuButton, { type MenuEntry } from "./MenuButton.svelte";
  import Modal from "./Modal.svelte";
  import Segmented from "./Segmented.svelte";
  import TilingTile from "./TilingTile.svelte";

  let {
    open = $bindable(false),
    highlight = null,
  }: { open?: boolean; highlight?: ChampionHighlight | null } = $props();

  let tiling = $state<TilingId>("square");
  let level = $state<Level>("beginner");
  let whose = $state<"mine" | "all">("mine");
  const player = $derived(game.settings?.playerName ?? null);
  let view = $state.raw<StatsView | null>(null);

  const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

  const tilingEntries: MenuEntry[] = $derived([
    {
      kind: "grid",
      label: t("picker.tiling"),
      columns: 6,
      items: TILINGS.map((id) => ({
        id,
        label: t(`tiling.${id}`),
        checked: tiling === id,
        onSelect: () => (tiling = id),
      })),
    },
  ]);

  $effect(() => {
    if (open) {
      tiling = highlight?.tiling ?? game.tiling;
      const preferred = highlight?.level ?? game.level;
      level = preferred === "custom" ? "beginner" : preferred;
      // A new record's rank counts every player.
      whose = highlight ? "all" : "mine";
    }
  });

  $effect(() => {
    if (!open) return;
    const [tl, lv, who] = [tiling, level, whose === "all" ? null : player];
    void api.getStats(tl, lv, who).then(
      (v) => {
        if (tl === tiling && lv === level && who === (whose === "all" ? null : player)) view = v;
      },
      (error: unknown) => game.reportError(error),
    );
  });
</script>

<Modal title={t("stats.title")} bind:open wide>
  <div class="filters">
    <MenuButton entries={tilingEntries} label={t("picker.tiling")}>
      <span>{t(`tiling.${tiling}`)}</span>
      <Icon name="chevron" size={14} />
      {#snippet tile(id)}
        <TilingTile {id} />
      {/snippet}
    </MenuButton>
    <Segmented
      label={t("picker.level")}
      options={LEVELS.map((id) => ({ value: id, label: t(`level.${id}`) }))}
      bind:value={level}
    />
    <Segmented
      label={t("stats.whose")}
      options={[
        { value: "mine", label: player ?? "" },
        { value: "all", label: t("stats.allPlayers") },
      ]}
      bind:value={whose}
    />
  </div>

  {#if view && view.players.length === 0}
    <p class="empty">{t("stats.empty")}</p>
  {:else if view}
    <h3>{t("stats.champions")}</h3>
    <table>
      <thead>
        <tr>
          <th class="num">{t("stats.rank")}</th>
          <th>{t("stats.player")}</th>
          <th class="num">{t("stats.time")}</th>
          <th class="num">{t("stats.clicks")}</th>
          <th class="num">{t("stats.date")}</th>
        </tr>
      </thead>
      <tbody>
        {#if view.champions.length === 0}
          <tr><td colspan="5" class="none">{t("stats.noChampions")}</td></tr>
        {/if}
        {#each view.champions as entry, i (i)}
          {@const isNew =
            highlight?.tiling === tiling && highlight.level === level && highlight.rank === i + 1}
          <tr class:gold={i === 0} class:new={isNew} aria-current={isNew ? "true" : undefined}>
            <td class="num">{i + 1}</td>
            <td>{entry.player}</td>
            <td class="num">{formatDuration(entry.durationMs)}</td>
            <td class="num">{entry.clicks}</td>
            <td class="num">{formatDate(entry.finishedAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h3>{t("stats.players")}</h3>
    <table>
      <thead>
        <tr>
          <th>{t("stats.player")}</th>
          <th class="num">{t("stats.games")}</th>
          <th class="num">{t("stats.wins")}</th>
          <th class="num">{t("stats.winRate")}</th>
          <th class="num">{t("stats.opened")}</th>
          <th class="num">{t("stats.avgTime")}</th>
          <th class="num">{t("stats.avgClicks")}</th>
        </tr>
      </thead>
      <tbody>
        {#each view.players as row (row.player)}
          <tr>
            <td>{row.player}</td>
            <td class="num">{row.games}</td>
            <td class="num">{row.wins}</td>
            <td class="num">{formatPercent((row.wins * 100) / Math.max(1, row.games))}</td>
            <td class="num">{formatPercent(row.avgOpenedPercent)}</td>
            <!-- Time and clicks average over wins only. -->
            <td class="num">{row.wins > 0 ? formatDuration(row.avgDurationMs) : "–"}</td>
            <td class="num">{row.wins > 0 ? formatNumber(row.avgClicks, ONE_DECIMAL) : "–"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#snippet footer()}
    <button class="primary" onclick={() => (open = false)}>{t("common.close")}</button>
  {/snippet}
</Modal>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  h3 {
    margin: 16px 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    font-weight: 600;
    color: var(--text-dim);
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 6px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  tr.gold td {
    color: var(--warn);
    font-weight: 600;
  }

  tr.new td {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    font-weight: 600;
  }

  .none {
    color: var(--text-dim);
    text-align: center;
  }

  .empty {
    color: var(--text-dim);
    padding: 24px 0;
    text-align: center;
  }
</style>
