<script lang="ts">
  import { numberColor } from "../lib/themes/catalog";
  import { cssColor as hex } from "../lib/themes/color";
  import type { GlyphName } from "../lib/themes/format";
  import { previewLight } from "../lib/themes/gloss";
  import type { BoardTheme } from "../lib/themes/types";

  let { board }: { board: BoardTheme } = $props();

  type Cell = "closed" | "flag" | "mine" | number;

  /** A patch of a game in progress: closed tiles, counts, a flag, and the mine that ended it. */
  const ROWS: readonly (readonly Cell[])[] = [
    ["closed", 1, 2, 1, "closed"],
    ["flag", 3, "mine", 2, "closed"],
    [0, 1, 2, "closed", "closed"],
  ];

  const glyph = (name: GlyphName) => board.glyphs[name]?.src;
  const closed = (cell: Cell) => cell === "closed" || cell === "flag";
  const filled = (cell: Cell) =>
    typeof cell === "number" && cell > 0 && board.numberStyle === "colors";

  function background(cell: Cell): string {
    if (closed(cell)) return hex(board.closed);
    if (filled(cell)) return hex(numberColor(board, cell as number));
    return hex(cell === "mine" ? board.exploded : board.open);
  }
</script>

<span
  class="preview"
  aria-hidden="true"
  style:background={board.plate === null ? "var(--glass-preview)" : hex(board.plate)}
  style:--gap="{Math.min(board.gap, 3)}px"
>
  {#each ROWS as row, r (r)}
    <span class="row" data-row>
      {#each row as cell, c (c)}
        <span
          class="cell"
          data-cell={String(cell)}
          style:background={background(cell)}
          style:background-image={filled(cell)
            ? null
            : previewLight(board, closed(cell) ? "closed" : "open")}
          style:color={typeof cell === "number" ? hex(numberColor(board, cell)) : hex(board.flag)}
          style:font-family={board.fontFamily}
          style:font-weight={board.fontWeight}
        >
          {#if cell === "flag"}
            {#if glyph("flag")}<img src={glyph("flag")} alt="" />{:else}⚑{/if}
          {:else if cell === "mine"}
            {#if glyph("mine")}<img src={glyph("mine")} alt="" />{:else}<span
                class="mine"
                data-mine
                style:background={hex(board.mine)}
                style:border-color={hex(board.mineSpark)}
              ></span>{/if}
          {:else if typeof cell === "number" && cell > 0 && !filled(cell)}
            {@const own = glyph(String(cell) as GlyphName)}
            {#if own}<img src={own} alt="" />{:else}{cell}{/if}
          {/if}
        </span>
      {/each}
    </span>
  {/each}
</span>

<style>
  /*
   * Pointy-top hexagons in staggered rows. A cell is as wide as five and a
   * half fit across, and each row tucks a quarter of a cell into the one
   * above it.
   */
  .preview {
    --w: calc((100% - 4 * var(--gap)) / 5.5);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4px 6px;
    border-radius: var(--radius);
    overflow: hidden;
  }

  .row {
    display: flex;
    gap: var(--gap);
  }

  .row + .row {
    margin-top: calc(var(--w) * -0.2887 + var(--gap));
  }

  .row:nth-child(2) {
    margin-inline-start: calc(var(--w) / 2 + var(--gap) / 2);
  }

  .cell {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--w);
    aspect-ratio: 0.866;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    font-size: 9cqw;
    line-height: 1;
  }

  .cell img {
    width: 62%;
    height: 62%;
    object-fit: contain;
  }

  .mine {
    width: 46%;
    aspect-ratio: 1;
    border: 2px solid;
    border-radius: 50%;
  }
</style>
