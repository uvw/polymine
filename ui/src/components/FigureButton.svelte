<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  let {
    icon,
    hoverIcon = icon,
    action,
    label,
    value,
    title,
    disabled = false,
    accent = false,
    negative = false,
    onclick,
  }: {
    icon: IconName;
    /** Shown in place of `icon` on hover and focus, to hint at what a click does. */
    hoverIcon?: IconName;
    action: string;
    label: string;
    value: string | number;
    title: string;
    disabled?: boolean;
    accent?: boolean;
    negative?: boolean;
    onclick: () => void;
  } = $props();
</script>

<!-- The outer box keeps the figure's width as digits come and go; the button
     inside hugs its content, so the highlight stays tight. -->
<span class="figure" class:negative>
  <button class:accent {title} {disabled} {onclick}>
    <span class="glyph">
      <Icon name={icon} size={15} />
      {#if hoverIcon !== icon}
        <Icon name={hoverIcon} size={15} />
      {/if}
    </span>
    <span class="sr-only">{action}</span>
    <span class="sr-only">{label}</span>
    <span class="value tabular">{value}</span>
  </button>
</span>

<style>
  .figure {
    display: flex;
    align-items: center;
    min-width: 56px;
    color: var(--text-dim);
    /* Presses between the controls reach the title bar's drag area. */
    pointer-events: none;
  }

  /* The padding sits outside the figure's box, so the glyph stays where a
     plain figure would put it. */
  button {
    gap: 6px;
    margin: 0 -8px;
    padding: 0 8px;
    color: inherit;
    background: transparent;
    border-color: transparent;
  }

  button:enabled {
    pointer-events: auto;
  }

  button:hover:enabled {
    background: var(--subtle-hover);
  }

  button:active:enabled {
    background: var(--subtle-pressed);
  }

  button:disabled {
    color: inherit;
  }

  .accent .glyph {
    color: var(--accent);
  }

  .glyph {
    display: grid;
  }

  .glyph > :global(svg) {
    grid-area: 1 / 1;
  }

  .glyph > :global(svg + svg),
  button:is(:hover, :focus-visible):enabled .glyph > :global(svg:first-child:not(:only-child)) {
    visibility: hidden;
  }

  button:is(:hover, :focus-visible):enabled .glyph > :global(svg + svg) {
    visibility: visible;
  }

  .value {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }

  .negative .value {
    color: var(--danger);
  }
</style>
