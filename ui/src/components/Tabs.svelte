<script lang="ts" generics="T extends string">
  /**
   * A horizontal tab list. Arrow keys, Home, and End move between tabs and
   * select them. Windows draws Fluent selector tabs, macOS a segmented control.
   */
  let {
    label,
    tabs,
    value,
    idPrefix,
    panel,
    onselect,
  }: {
    label: string;
    tabs: readonly { id: T; label: string }[];
    value: T;
    /** Each tab's id is `<idPrefix>-<tab id>`, for the panel's `aria-labelledby`. */
    idPrefix: string;
    /** The id of the panel the tabs control. */
    panel: string;
    onselect: (id: T) => void;
  } = $props();

  function onkeydown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const next = target === undefined ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault();
    onselect(next.id);
    document.getElementById(`${idPrefix}-${next.id}`)?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label={label}>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      role="tab"
      id="{idPrefix}-{tab.id}"
      aria-selected={value === tab.id}
      aria-controls={panel}
      tabindex={value === tab.id ? 0 : -1}
      onclick={() => onselect(tab.id)}
      {onkeydown}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
  }

  button {
    position: relative;
    min-height: 32px;
    padding: 0 12px;
    background: none;
    border-color: transparent;
    color: var(--text-dim);
  }

  button:hover:not(:disabled) {
    background: var(--subtle-hover);
    color: var(--text);
  }

  button[aria-selected="true"] {
    color: var(--text);
  }

  /* Fluent's selector bar marks the current tab with a short accent pill under it. */
  button[aria-selected="true"]::after {
    content: "";
    position: absolute;
    bottom: 1px;
    left: 50%;
    width: 16px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    transform: translateX(-50%);
  }

  :global(.platform-macos) .tabs {
    gap: 2px;
    width: fit-content;
    margin-inline: auto;
    padding: 2px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    background: var(--subtle-hover);
  }

  :global(.platform-macos) button {
    min-height: 22px;
    padding: 0 14px;
    border: none;
    border-radius: calc(var(--radius) - 1px);
  }

  :global(.platform-macos) button:hover:not(:disabled) {
    background: none;
  }

  :global(.platform-macos) button[aria-selected="true"] {
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--stroke-strong);
  }

  :global(.platform-macos) button[aria-selected="true"]::after {
    content: none;
  }
</style>
