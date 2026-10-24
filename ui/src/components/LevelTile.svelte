<script lang="ts">
  import Icon from "./Icon.svelte";

  /** A level drawn as one to four mines, or sliders for a custom level. */
  let { mines }: { mines: number | null } = $props();
</script>

<span class="level" aria-hidden="true">
  {#if mines === null}
    <Icon name="sliders" size={18} />
  {:else}
    {#each [...Array(mines).keys()] as i (i)}
      <Icon name="mine" size={14} />
    {/each}
  {/if}
</span>

<style>
  .level {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 28px;
    color: var(--text);
  }
</style>
