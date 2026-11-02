/** Colors for the small tiling previews in the level and tiling picker. */

import { contrast } from "./color";
import { VISIBLE } from "./filter";
import type { BoardTheme } from "./types";

/**
 * The color a tiling preview draws its edges in. The plate comes first, to keep
 * the theme's own look, where it stands out from the closed cells. Many themes
 * keep closed and open cells close on purpose, which reads on the board but not
 * at thumbnail size. Then come the first count (the keyword color in an editor
 * theme) and the focus color, and last whichever candidate stands out most.
 */
export function thumbEdge(board: BoardTheme): number {
  const candidates = [board.plate ?? board.open, board.numbers[0] ?? board.focus, board.focus];
  const visible = candidates.find((color) => contrast(color, board.closed) >= VISIBLE);
  return (
    visible ??
    candidates.reduce((best, color) =>
      contrast(color, board.closed) > contrast(best, board.closed) ? color : best,
    )
  );
}
