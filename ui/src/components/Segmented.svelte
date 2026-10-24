<script lang="ts" generics="T extends string">
  /** A native radio group drawn as a segmented control; arrow keys move between options. */
  let {
    label,
    options,
    value = $bindable(),
  }: {
    label: string;
    options: readonly { value: T; label: string }[];
    value: T;
  } = $props();

  const name = `segmented-${Math.random().toString(36).slice(2)}`;
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <label class:on={value === option.value}>
      <input type="radio" {name} value={option.value} bind:group={value} />
      {option.label}
    </label>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    align-self: flex-start;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--subtle-hover);
    border: 1px solid var(--stroke);
  }

  label {
    position: relative;
    padding: 4px 12px;
    border-radius: calc(var(--radius) - 1px);
    color: var(--text-dim);
    font-size: var(--font-caption);
    cursor: default;
  }

  label:hover {
    color: var(--text);
  }

  label.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--stroke-strong);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
</style>
