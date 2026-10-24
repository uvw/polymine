<script lang="ts">
  import { api } from "../lib/api";
  import type { SaveInfo } from "../lib/bindings";
  import { formatDateTime, formatDuration } from "../lib/format";
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import { MAX_SAVE_NAME, sameSaveName, saveNameProblem } from "../lib/saves";
  import Modal from "./Modal.svelte";
  import TilingThumb from "./TilingThumb.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state("");
  let saves = $state.raw<SaveInfo[]>([]);
  /** The save whose Delete was pressed once, waiting for the second press. */
  let confirming = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);

  const canSave = $derived(game.status === "playing");
  const problem = $derived(saveNameProblem(name));
  const replacing = $derived(saves.find((s) => sameSaveName(s.name, name)) ?? null);
  const problemText = $derived.by(() => {
    switch (problem) {
      case "long":
        return t("saves.nameLong", { max: MAX_SAVE_NAME });
      case "chars":
        return t("saves.nameChars");
      case "reserved":
        return t("saves.nameReserved");
      case "dot":
        return t("saves.nameDot");
      default:
        return null;
    }
  });

  $effect(() => {
    if (!open) return;
    name = "";
    confirming = null;
    error = null;
    void refresh();
  });

  async function refresh() {
    try {
      saves = await api.listSaves();
    } catch (e) {
      error = t("error.generic", { message: String(e) });
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!canSave || problem || saving) return;
    saving = true;
    error = null;
    const info = await game.saveAs(name.trim());
    saving = false;
    if (!info) {
      error = game.error;
      return;
    }
    name = "";
    await refresh();
  }

  function load(save: SaveInfo) {
    open = false;
    void game.loadSave(save.name);
  }

  async function remove(save: SaveInfo) {
    confirming = null;
    error = null;
    try {
      await api.deleteSave(save.name);
    } catch (e) {
      error = t("error.generic", { message: String(e) });
    }
    await refresh();
  }

  function level(save: SaveInfo): string {
    return save.level === "custom"
      ? t("saves.custom", { cols: save.cols, rows: save.rows, mines: save.mines })
      : t(`level.${save.level}`);
  }
</script>

<Modal title={t("saves.title")} bind:open wide>
  <form id="save-game" class="name" onsubmit={save} novalidate>
    <label for="save-name">{t("saves.name")}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="save-name"
      type="text"
      bind:value={name}
      disabled={!canSave}
      aria-invalid={problemText !== null}
      aria-describedby="save-help"
      autocomplete="off"
      spellcheck="false"
      autofocus
    />
    <small id="save-help" class:invalid={problemText !== null}>
      {#if !canSave}
        {t("saves.nothingToSave")}
      {:else if problemText}
        {problemText}
      {:else if replacing}
        {t("saves.replaceHelp", { name: replacing.name })}
      {/if}
    </small>
  </form>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <h3 id="saves-heading">{t("saves.list")}</h3>
  <p class="note">{t("saves.assisted")}</p>
  {#if saves.length === 0}
    <p class="empty">{t("saves.empty")}</p>
  {:else}
    <ul aria-labelledby="saves-heading">
      {#each saves as save (save.name)}
        {@const preview = game.previews.find((p) => p.tiling === save.tiling)}
        <li>
          {#if preview}
            <TilingThumb
              polygons={preview.polygons}
              board={game.theme.board}
              width={60}
              height={44}
            />
          {:else}
            <span class="thumb"></span>
          {/if}
          <span class="text">
            <strong>{save.name}</strong>
            <span class="meta">{t(`tiling.${save.tiling}`)} · {level(save)}</span>
            <span class="meta">
              {t("saves.details", {
                time: formatDuration(save.elapsedMs),
                date: formatDateTime(save.savedAt),
              })}
            </span>
          </span>
          {#if confirming === save.name}
            <span
              class="actions"
              role="group"
              aria-label={t("saves.confirmDelete", { name: save.name })}
            >
              <button class="danger" onclick={() => void remove(save)}>{t("saves.delete")}</button>
              <!-- The Delete pressed a moment ago is gone, so the safe choice takes the focus. -->
              <button {@attach (button) => button.focus()} onclick={() => (confirming = null)}>
                {t("saves.keep")}
              </button>
            </span>
          {:else}
            <span class="actions">
              <button
                aria-label={t("saves.loadNamed", { name: save.name })}
                onclick={() => load(save)}
              >
                {t("saves.load")}
              </button>
              <button
                aria-label={t("saves.deleteNamed", { name: save.name })}
                onclick={() => (confirming = save.name)}
              >
                {t("saves.delete")}
              </button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#snippet footer()}
    <button onclick={() => (open = false)}>{t("common.close")}</button>
    <button
      class="primary"
      type="submit"
      form="save-game"
      disabled={!canSave || problem !== null || saving}
    >
      {replacing ? t("saves.replace") : t("saves.save")}
    </button>
  {/snippet}
</Modal>

<style>
  .name {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label,
  small,
  .note,
  .meta {
    font-size: var(--font-caption);
    color: var(--text-dim);
  }

  small {
    min-height: 1.4em;
  }

  small.invalid,
  .error {
    color: var(--danger);
  }

  input[aria-invalid="true"] {
    border-bottom-color: var(--danger);
  }

  .error {
    margin: 0 0 8px;
  }

  h3 {
    margin: 12px 0 2px;
    font-size: inherit;
    font-weight: 600;
  }

  .note {
    margin: 0 0 8px;
  }

  .empty {
    margin: 16px 0;
    color: var(--text-dim);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--divider);
  }

  .thumb {
    flex: none;
    width: 60px;
    height: 44px;
    border-radius: 4px;
    background: var(--control);
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .text strong,
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex: none;
    gap: 8px;
  }

  button.danger {
    color: var(--danger);
  }
</style>
