<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { platform, prefersReducedMotion } from "../lib/platform.svelte";
  import WindowControls from "./WindowControls.svelte";

  let {
    title,
    open = $bindable(false),
    wide = false,
    fixed = false,
    children,
    footer,
  }: {
    title: string;
    open?: boolean;
    wide?: boolean;
    /** A fixed-height dialog whose content lays out and scrolls its own panes. */
    fixed?: boolean;
    children: Snippet;
    /** Dialog buttons in macOS order, primary last. Windows reverses them. */
    footer: Snippet;
  } = $props();

  const CLOSE_MS = 120;
  const titleId = $props.id();
  let dialog: HTMLDialogElement;
  let closing = $state(false);
  let content = $state(false);

  // The dialog fills the window and draws the backdrop, so the window still
  // drags from everywhere outside the dialog's box, title bar included.
  const titleBar = $derived(platform() === "macos" || platform() === "windows");
  const drag = $derived(titleBar ? "" : undefined);

  $effect(() => {
    if (open && !dialog.open) {
      closing = false;
      content = true;
      dialog.showModal();
      // The content renders after this effect, so `showModal` had nothing to focus.
      void tick().then(() => {
        if (dialog.open) dialog.querySelector<HTMLElement>("[autofocus]")?.focus();
      });
    } else if (open) {
      // Opened again during the close fade, which the cleanup below cancelled.
      closing = false;
    } else if (dialog.open) {
      closing = true;
      const timer = setTimeout(() => dialog.close(), prefersReducedMotion() ? 0 : CLOSE_MS);
      return () => clearTimeout(timer);
    }
  });

  function onCancel(event: Event) {
    // Escape: animate out through `open` instead of closing at once.
    event.preventDefault();
    open = false;
  }
</script>

<dialog
  bind:this={dialog}
  class:closing
  class:title-bar={titleBar}
  data-tauri-drag-region={drag}
  aria-labelledby={titleId}
  oncancel={onCancel}
  onclose={() => {
    open = false;
    content = false;
  }}
>
  {#if content}
    <div class="box" class:wide class:fixed>
      <h2 id={titleId} data-tauri-drag-region={drag}>{title}</h2>
      <div class="body">{@render children()}</div>
      <footer>{@render footer()}</footer>
    </div>
    <!-- After the box, so opening the dialog focuses its content first. -->
    {#if platform() === "windows"}
      <div class="caption"><WindowControls /></div>
    {/if}
  {/if}
</dialog>

<style>
  /* A transparent layer over the whole window; the box inside is what looks like a dialog. */
  dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text);
    overflow: hidden;
    user-select: none;
  }

  dialog[open] {
    display: grid;
    place-items: center;
  }

  /* The title bar stays clear, so it shows the window it belongs to and its buttons work. */
  dialog.title-bar {
    padding-top: var(--toolbar-height);
  }

  dialog::backdrop {
    background: var(--backdrop);
  }

  .box {
    display: flex;
    flex-direction: column;
    width: min(460px, calc(100vw - 48px));
    max-height: calc(100% - 64px);
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: enter 200ms var(--ease-out);
  }

  .closing .box {
    animation: leave 120ms ease-in forwards;
  }

  .box.wide {
    width: min(720px, calc(100vw - 48px));
  }

  /* Room for the Themes page's four columns and more than one row of cards. */
  .box.fixed {
    width: min(900px, calc(100vw - 40px));
    height: min(700px, calc(100% - 12px));
    max-height: none;
  }

  .box.fixed .body {
    flex: 1;
    min-height: 0;
    padding: 0;
    overflow: hidden;
  }

  .caption {
    position: absolute;
    top: 0;
    inset-inline-end: 0;
    display: flex;
    height: var(--toolbar-height);
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: scale(1.05);
    }
  }

  @keyframes leave {
    to {
      opacity: 0;
    }
  }

  h2 {
    margin: 0;
    padding: 24px 24px 12px;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 600;
  }

  :global(.platform-macos) h2 {
    padding: 20px 20px 8px;
    font-size: 15px;
    font-weight: 700;
    text-align: center;
  }

  .body {
    padding: 0 24px 16px;
    overflow: auto;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 20px 24px 24px;
    background: color-mix(in srgb, var(--window) 60%, var(--surface));
    border-top: 1px solid var(--divider);
  }

  /*
   * Windows content dialogs share the row between two or more buttons and put
   * the primary first. A lone button keeps its own width at the right.
   */
  :global(.platform-windows) footer:has(> :global(button + button)) > :global(button) {
    flex: 1;
  }

  :global(.platform-windows) footer > :global(button) {
    min-width: 120px;
  }

  :global(.platform-windows) footer > :global(.primary) {
    order: -1;
  }

  :global(.platform-macos) footer {
    padding: 12px 20px 16px;
    background: transparent;
    border-top: none;
  }

  :global(.platform-macos) footer > :global(button) {
    min-width: 72px;
  }
</style>
