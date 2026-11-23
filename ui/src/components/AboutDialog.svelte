<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { api } from "../lib/api";
  import { t } from "../lib/i18n";
  import Modal from "./Modal.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let version = $state("");
  let showNotices = $state(false);
  let notices = $state("");
  const noticesId = $props.id();

  $effect(() => {
    if (open && !version) void getVersion().then((v) => (version = v));
    if (!open) showNotices = false;
  });

  async function openRepository() {
    try {
      await api.openRepository();
    } catch (error) {
      console.warn("could not open the repository", error);
    }
  }

  async function toggleNotices() {
    showNotices = !showNotices;
    // About a quarter of a megabyte, so it loads only when asked for.
    if (showNotices && !notices) {
      notices = (await import("../lib/notices/THIRD-PARTY-NOTICES.txt?raw")).default;
    }
  }
</script>

<Modal title={t("about.title")} bind:open wide={showNotices}>
  <div class="about">
    <img src="/icon.svg" alt="" width="80" height="80" />
    <div>
      <h3>{t("app.title")}</h3>
      {#if version}<p class="dim">{t("about.version", { version })}</p>{/if}
      <p>{t("about.body")}</p>
      <p class="dim">{t("about.inspired")} {t("about.license")}</p>
      <p><button class="link" onclick={openRepository}>{t("about.repository")}</button></p>
    </div>
  </div>
  {#if showNotices}
    <!-- Focusable so the keyboard can scroll it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre
      id={noticesId}
      class="notices"
      role="region"
      tabindex="0"
      aria-label={t("about.notices")}>{notices}</pre>
  {/if}

  {#snippet footer()}
    <button aria-expanded={showNotices} aria-controls={noticesId} onclick={toggleNotices}>
      {t("about.notices")}
    </button>
    <button class="primary" onclick={() => (open = false)}>{t("common.close")}</button>
  {/snippet}
</Modal>

<style>
  .about {
    display: flex;
    gap: 18px;
    align-items: center;
  }

  h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 600;
  }

  p {
    margin: 6px 0 0;
  }

  /* The repository opens in the browser, so the button reads as a link. */
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

  .dim {
    color: var(--text-dim);
    font-size: var(--font-caption);
  }

  .notices {
    height: 50vh;
    margin: 16px 0 0;
    padding: 8px 10px;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: var(--radius);
    font-size: var(--font-caption);
    white-space: pre;
    user-select: text;
  }
</style>
