<script lang="ts">
  import { game } from "../lib/game.svelte";
  import TilingThumb from "./TilingThumb.svelte";

  /** A tiling's thumbnail with its complexity as pips, for picker grids. */
  let { id }: { id: string } = $props();

  const PIPS = [...Array(5).keys()];
  const preview = $derived(game.previews.find((p) => p.tiling === id));
</script>

{#if preview}
  <TilingThumb polygons={preview.polygons} board={game.theme.board} />
  <span class="pips" aria-hidden="true">
    {#each PIPS as i (i)}
      <i class:on={i < preview.complexity}></i>
    {/each}
  </span>
{/if}

<style>
  .pips {
    display: flex;
    gap: 3px;
  }

  .pips i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text) 20%, transparent);
  }

  .pips i.on {
    background: var(--text);
  }
</style>
