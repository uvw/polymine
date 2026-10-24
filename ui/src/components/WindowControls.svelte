<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { t } from "../lib/i18n";

  /** Minimize, maximize, and close buttons. The window has no frame of its own on Windows. */
  const appWindow = getCurrentWindow();
  let maximized = $state(false);

  const warn = (action: string) => (e: unknown) =>
    console.warn(`could not ${action} the window`, e);

  onMount(() => {
    const sync = () =>
      void appWindow
        .isMaximized()
        .then((value) => (maximized = value))
        .catch(warn("read the state of"));
    sync();
    const stop = appWindow.onResized(sync);
    return () => void stop.then((unlisten) => unlisten());
  });
</script>

<div class="controls">
  <button
    class="control"
    aria-label={t("window.minimize")}
    title={t("window.minimize")}
    onclick={() => void appWindow.minimize().catch(warn("minimize"))}
  >
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
  </button>
  <button
    class="control"
    aria-label={maximized ? t("window.restore") : t("window.maximize")}
    title={maximized ? t("window.restore") : t("window.maximize")}
    onclick={() => void appWindow.toggleMaximize().catch(warn("maximize"))}
  >
    {#if maximized}
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" />
      </svg>
    {:else}
      <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" /></svg>
    {/if}
  </button>
  <button
    class="control close"
    aria-label={t("window.close")}
    title={t("window.close")}
    onclick={() => void appWindow.close().catch(warn("close"))}
  >
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0 0 10" /></svg>
  </button>
</div>

<style>
  .controls {
    display: flex;
    align-self: stretch;
    margin-left: 8px;
  }

  .control {
    width: 46px;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text);
  }

  .control:hover {
    background: var(--subtle-hover);
  }

  .control:active {
    background: var(--subtle-pressed);
  }

  .close:hover,
  .close:active {
    background: var(--caption-close);
    color: var(--on-caption-close);
  }

  svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
</style>
