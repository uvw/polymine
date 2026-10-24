import type { CellView } from "./bindings";
import { t } from "./i18n";

/** Spoken description of a cell for screen readers, with one-based row and column. */
export function describeCell(view: CellView, row: number, col: number): string {
  return t("a11y.cell", { row: row + 1, col: col + 1, state: describeState(view) });
}

/** Spoken hint for screen readers, with the hinted cell's one-based row and column. */
export function describeHint(hint: string, row: number, col: number): string {
  return t("a11y.hint", { row: row + 1, col: col + 1, hint });
}

function describeState(view: CellView): string {
  switch (view.kind) {
    case "closed":
      if (view.mark === "flag") return t("a11y.flagged");
      if (view.mark === "question") return t("a11y.question");
      return t("a11y.closed");
    case "open":
      if (view.adjacent === 0) return t("a11y.empty");
      return view.adjacent === 1 ? t("a11y.oneMine") : t("a11y.mines", { n: view.adjacent });
    case "mine":
      return view.exploded ? t("a11y.exploded") : t("a11y.mine");
    case "wrongFlag":
      return t("a11y.wrongFlag");
  }
}
