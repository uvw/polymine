<script lang="ts">
  import type { Snippet } from "svelte";
  import { placeFlyout, type Placement } from "../lib/flyout";

  /**
   * A tooltip with an arrow that points at its anchor. It shows while
   * `anchor` is set and stays inside `bounds`: a Fluent tooltip on Windows,
   * an AppKit popover on macOS.
   */
  let {
    id,
    anchor,
    bounds,
    onpointerenter,
    onpointerleave,
    children,
  }: {
    id: string;
    anchor: HTMLElement | null;
    bounds: HTMLElement | undefined;
    onpointerenter?: () => void;
    onpointerleave?: () => void;
    children: Snippet;
  } = $props();

  let tip: HTMLDivElement;
  let place = $state<Placement | null>(null);

  // The top layer keeps the scrolling settings pane from clipping it.
  $effect(() => {
    if (!anchor) return;
    tip.showPopover();
    place = placeFlyout(
      anchor.getBoundingClientRect(),
      { width: tip.offsetWidth, height: tip.offsetHeight },
      (bounds ?? document.documentElement).getBoundingClientRect(),
    );
    return () => {
      place = null;
      if (tip.isConnected) tip.hidePopover();
    };
  });
</script>

<div
  bind:this={tip}
  {id}
  class="flyout"
  class:placed={place !== null}
  class:above={place?.side === "above"}
  class:below={place?.side !== "above"}
  role="tooltip"
  popover="manual"
  style:top={place ? `${place.top}px` : undefined}
  style:left={place ? `${place.left}px` : undefined}
  style:--arrow-x={place ? `${place.arrow}px` : undefined}
  {onpointerenter}
  {onpointerleave}
>
  {@render children()}
</div>

<style>
  .flyout {
    position: fixed;
    inset: auto;
    width: max-content;
    max-width: var(--flyout-width);
    margin: 0;
    padding: var(--flyout-padding);
    overflow: visible;
    color: var(--text);
    font-size: var(--font-caption);
    line-height: 1.4;
    background: var(--flyout);
    border: 1px solid var(--flyout-stroke);
    border-radius: var(--flyout-radius);
    box-shadow: var(--flyout-shadow);
    user-select: text;
  }

  .flyout.placed {
    animation: appear 120ms var(--ease-out);
  }

  /* A square turned 45 degrees, half of it outside, with the flyout's fill and two of its edges. */
  .flyout::before {
    content: "";
    position: absolute;
    left: var(--arrow-x, 50%);
    width: var(--flyout-arrow);
    height: var(--flyout-arrow);
    background: var(--flyout);
    border: 1px solid var(--flyout-stroke);
    border-radius: 1px;
    translate: -50% 0;
    rotate: 45deg;
  }

  .below::before {
    top: calc(var(--flyout-arrow) / -2 - 1px);
    border-right-color: transparent;
    border-bottom-color: transparent;
  }

  .above::before {
    bottom: calc(var(--flyout-arrow) / -2 - 1px);
    border-top-color: transparent;
    border-left-color: transparent;
  }

  @keyframes appear {
    from {
      opacity: 0;
      translate: 0 var(--flyout-shift, -4px);
    }
  }

  .above {
    --flyout-shift: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .flyout.placed {
      animation: none;
    }
  }
</style>
