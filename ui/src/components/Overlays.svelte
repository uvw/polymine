<script lang="ts">
  import { fade } from "svelte/transition";
  import { game } from "../lib/game.svelte";
  import { t } from "../lib/i18n";
  import Icon from "./Icon.svelte";
</script>

{#if game.paused}
  <!-- Right click resumes, as on the board itself. -->
  <div
    class="pause"
    role="presentation"
    oncontextmenu={(e) => {
      e.preventDefault();
      void game.togglePause();
    }}
    transition:fade={{ duration: 150 }}
  >
    <button class="card" aria-label={t("pause.resume")} onclick={() => game.togglePause()}>
      <Icon name="play" size={28} />
      <span class="title">{t("pause.title")}</span>
    </button>
  </div>
{/if}

{#if game.error}
  <div class="error" role="alert" transition:fade={{ duration: 150 }}>{game.error}</div>
{/if}

<div class="sr-only" role="status" aria-live="polite">{game.announcement}</div>

<style>
  .pause {
    position: absolute;
    inset: 0 8px 8px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  /* Dots in the accent color drift slowly behind the card while paused. */
  .pause::before {
    content: "";
    position: absolute;
    inset: -48px;
    background-image:
      radial-gradient(
        circle,
        color-mix(in srgb, var(--accent) 35%, transparent) 2px,
        transparent 3px
      ),
      radial-gradient(
        circle,
        color-mix(in srgb, var(--accent) 18%, transparent) 1.5px,
        transparent 2.5px
      );
    background-size:
      48px 48px,
      24px 24px;
    background-position:
      0 0,
      12px 12px;
    animation: drift 24s linear infinite;
    pointer-events: none;
  }

  @keyframes drift {
    to {
      transform: translate(48px, 48px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pause::before {
      animation: none;
    }
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    height: auto;
    padding: 20px 36px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--stroke);
    box-shadow: var(--shadow);
    color: var(--accent);
  }

  .card:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }

  .title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .error {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 48px);
    padding: 8px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--danger) 50%, var(--stroke));
    color: var(--danger);
    box-shadow: var(--shadow);
  }
</style>
