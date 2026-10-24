<script lang="ts">
  import type { Point } from "../lib/bindings";
  import { cssColor } from "../lib/themes/color";
  import { thumbEdge } from "../lib/themes/thumb";
  import type { BoardTheme } from "../lib/themes/types";

  let {
    polygons,
    board,
    width = 72,
    height = 52,
  }: {
    polygons: readonly (readonly Point[])[];
    board: BoardTheme;
    width?: number;
    height?: number;
  } = $props();

  // The preview board's edges are ragged, so only its middle is shown.
  const viewBox = $derived.by(() => {
    const xs = polygons.flat().map((p) => p.x);
    const ys = polygons.flat().map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const aspect = width / height;
    const w = Math.min((x1 - x0) * 0.6, (y1 - y0) * 0.6 * aspect);
    const h = w / aspect;
    return `${(x0 + x1 - w) / 2} ${(y0 + y1 - h) / 2} ${w} ${h}`;
  });

  const path = $derived(
    polygons.map((poly) => `M${poly.map((p) => `${p.x} ${p.y}`).join("L")}Z`).join(""),
  );
</script>

<svg {width} {height} {viewBox} aria-hidden="true" style:background={cssColor(board.open)}>
  <path
    d={path}
    fill={cssColor(board.closed)}
    stroke={cssColor(thumbEdge(board))}
    stroke-width="1.5"
    stroke-linejoin="round"
    vector-effect="non-scaling-stroke"
  />
</svg>

<style>
  svg {
    display: block;
    border-radius: 4px;
  }
</style>
