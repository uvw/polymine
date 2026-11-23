<script lang="ts">
  import { fly } from "svelte/transition";
  import { formatPercent } from "../lib/format";
  import { t } from "../lib/i18n";
  import { prefersReducedMotion } from "../lib/platform.svelte";
  import { updates } from "../lib/updates.svelte";

  const id = $props.id();
  const busy = $derived(
    updates.installation.kind === "downloading" || updates.installation.kind === "installing",
  );
</script>

{#if updates.notice}
  {@const release = updates.notice}
  {@const installation = updates.installation}
  <section
    class="notice"
    aria-labelledby="{id}-title"
    transition:fly={{ y: 16, duration: prefersReducedMotion() ? 0 : 200 }}
  >
    <p class="title" id="{id}-title" role="status">
      {t("update.available", { version: release.version })}
    </p>
    {#if installation.kind === "downloading"}
      <p class="detail">
        {installation.percent === null
          ? t("update.downloading")
          : t("update.downloadingPercent", { percent: formatPercent(installation.percent) })}
      </p>
      <progress max="100" value={installation.percent ?? undefined} aria-labelledby="{id}-title"
      ></progress>
    {:else if installation.kind === "installing"}
      <p class="detail">{t("update.installing")}</p>
      <progress aria-labelledby="{id}-title"></progress>
    {:else if installation.kind === "failed"}
      <p class="detail failed" role="alert">
        {t("update.failed", { message: installation.message })}
      </p>
    {/if}
    <div class="actions">
      <button class="link" onclick={() => void updates.openNotes()}>{t("update.notes")}</button>
      <span class="spacer"></span>
      <button onclick={() => updates.later()} disabled={busy}>{t("update.later")}</button>
      {#if !busy}
        <button class="primary" onclick={() => void updates.install()}>
          {installation.kind === "failed" ? t("update.retry") : t("update.install")}
        </button>
      {/if}
    </div>
  </section>
{/if}

<style>
  .notice {
    position: absolute;
    inset-inline-end: 16px;
    bottom: 16px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(360px, calc(100% - 32px));
    padding: 14px 16px 12px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--stroke);
    box-shadow: var(--shadow);
  }

  p {
    margin: 0;
  }

  .title {
    font-weight: 600;
  }

  .detail {
    color: var(--text-dim);
    font-size: var(--font-caption);
  }

  .failed {
    color: var(--danger);
  }

  progress {
    width: 100%;
    accent-color: var(--accent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .spacer {
    flex: 1;
  }

  /* The release notes open in the browser, so the button reads as a link. */
  button.link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    text-decoration: underline;
  }

  button.link:hover:not(:disabled) {
    background: none;
    color: var(--accent-hover);
  }
</style>
