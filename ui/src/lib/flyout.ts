/** A box in window coordinates, as `getBoundingClientRect()` gives it. */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The anchor's side the flyout opens on. */
  side: "above" | "below";
  /** The arrow's distance from the flyout's left edge. */
  arrow: number;
}

/** Space between the anchor and the flyout, which the arrow spans. */
const GAP = 8;
/** Keeps the flyout this far inside its bounds. */
const MARGIN = 8;
/** Keeps the arrow clear of the flyout's rounded corners. */
const ARROW_INSET = 16;

/** Pins `value` between `low` and `high`, with `low` winning when they cross. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Places a flyout of `size` under `anchor`, or above it when only that side
 * has room, centered on the anchor and kept inside `bounds`.
 */
export function placeFlyout(
  anchor: Box,
  size: { width: number; height: number },
  bounds: Box,
): Placement {
  const below = bounds.bottom - MARGIN - (anchor.bottom + GAP);
  const above = anchor.top - GAP - (bounds.top + MARGIN);
  const side = below >= size.height || below >= above ? "below" : "above";
  const center = (anchor.left + anchor.right) / 2;
  const left = clamp(
    center - size.width / 2,
    bounds.left + MARGIN,
    bounds.right - MARGIN - size.width,
  );
  return {
    top: side === "below" ? anchor.bottom + GAP : anchor.top - GAP - size.height,
    left,
    side,
    arrow: clamp(center - left, ARROW_INSET, size.width - ARROW_INSET),
  };
}
