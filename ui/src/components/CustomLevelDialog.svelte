<script lang="ts">
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import Modal from "./Modal.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const MIN_SIDE = 3;
  const MAX_SIDE = 200;

  let cols = $state(16);
  let rows = $state(16);
  let mines = $state(40);

  $effect(() => {
    if (open && game.settings) {
      ({ cols, rows, mines } = game.settings.custom);
    }
  });

  const sideOk = (n: number) => Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE;
  const colsOk = $derived(sideOk(cols));
  const rowsOk = $derived(sideOk(rows));
  const maxMines = $derived(cols * rows - 1);
  // Mine limits depend on the size, so they're only judged once the size is valid.
  const minesOk = $derived(
    !colsOk || !rowsOk || (Number.isInteger(mines) && mines >= 1 && mines <= maxMines),
  );
  const valid = $derived(colsOk && rowsOk && minesOk);

  /** Sets the size that fills the window, keeping the mine density. */
  async function fill() {
    const density = valid ? mines / (cols * rows) : 0.15;
    const size = await game.fillSize(game.tiling, density);
    if (size) ({ cols, rows, mines } = size);
  }

  function start(event: SubmitEvent) {
    event.preventDefault();
    if (!valid) return;
    open = false;
    void game.newGame(game.tiling, "custom", { cols, rows, mines });
  }
</script>

<Modal title={t("custom.title")} bind:open>
  <form id="custom-level" class="grid" onsubmit={start} novalidate>
    <label>
      {t("custom.cols")}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="number"
        bind:value={cols}
        aria-invalid={!colsOk}
        aria-describedby={colsOk ? undefined : "cols-error"}
        autofocus
      />
      {#if !colsOk}
        <small id="cols-error">{t("custom.sizeInvalid", { min: MIN_SIDE, max: MAX_SIDE })}</small>
      {/if}
    </label>
    <label>
      {t("custom.rows")}
      <input
        type="number"
        bind:value={rows}
        aria-invalid={!rowsOk}
        aria-describedby={rowsOk ? undefined : "rows-error"}
      />
      {#if !rowsOk}
        <small id="rows-error">{t("custom.sizeInvalid", { min: MIN_SIDE, max: MAX_SIDE })}</small>
      {/if}
    </label>
    <label>
      {t("custom.mines")}
      <input
        type="number"
        bind:value={mines}
        aria-invalid={!minesOk}
        aria-describedby={minesOk ? undefined : "mines-error"}
      />
      {#if !minesOk}
        <small id="mines-error">{t("custom.minesInvalid", { maxMines })}</small>
      {/if}
    </label>
  </form>

  {#snippet footer()}
    <button onclick={() => void fill()} disabled={!game.boardArea}>{t("custom.fill")}</button>
    <button onclick={() => (open = false)}>{t("common.cancel")}</button>
    <button class="primary" type="submit" form="custom-level" disabled={!valid}>
      {t("custom.start")}
    </button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    align-items: start;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--font-caption);
    color: var(--text-dim);
  }

  input {
    width: 100%;
  }

  input[aria-invalid="true"] {
    border-bottom-color: var(--danger);
  }

  small {
    color: var(--danger);
  }
</style>
