<script lang="ts">
  import { onMount } from "svelte";
  import AboutDialog from "./components/AboutDialog.svelte";
  import BoardCanvas from "./components/BoardCanvas.svelte";
  import CustomLevelDialog from "./components/CustomLevelDialog.svelte";
  import Overlays from "./components/Overlays.svelte";
  import SavesDialog from "./components/SavesDialog.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import StatsDialog from "./components/StatsDialog.svelte";
  import TopBar from "./components/TopBar.svelte";
  import UpdateNotice from "./components/UpdateNotice.svelte";
  import { api, hasShell } from "./lib/api";
  import { chromeStyle } from "./lib/themes/accent";
  import { applyWindowIcon } from "./lib/windowIcon";
  import type { Rules } from "./lib/bindings";
  import { game } from "./lib/game.svelte";
  import { t } from "./lib/i18n";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LEVELS, installMacMenu, type MenuState } from "./lib/menu";
  import { applyEnvironment, platform, prefersReducedMotion } from "./lib/platform.svelte";
  import { updates } from "./lib/updates.svelte";
  import type { ChampionHighlight } from "./components/StatsDialog.svelte";

  type Dialog = "custom" | "saves" | "stats" | "settings" | "about";

  /** Keys that open a dialog, and close it again when pressed with it open. */
  const DIALOG_KEYS: Record<string, Dialog> = {
    f1: "about",
    f3: "stats",
    f4: "stats",
    f5: "settings",
    "5": "custom",
  };

  /** Ctrl chords that open a dialog, outside macOS. */
  const CHORD_KEYS: Record<string, Dialog> = { ",": "settings", s: "saves" };

  /** Time for the win animation to play before the champions table opens. */
  const RECORD_DELAY_MS = 1500;
  /** How often to check the window is still in front while the page is without focus. */
  const FRONT_CHECK_MS = 300;
  /** Presses of one key closer than this count as one, from menu and keyboard alike. */
  const SAME_PRESS_MS = 200;

  let ready = $state(false);
  let startupError = $state<string | null>(null);
  let dialogs = $state<Record<Dialog, boolean>>({
    custom: false,
    saves: false,
    stats: false,
    settings: false,
    about: false,
  });
  let champion = $state<ChampionHighlight | null>(null);
  /** A named instance's name, shown in the title so its window stands apart. */
  let instance = $state<string | null>(null);
  let syncMenu = $state<((state: MenuState) => void) | null>(null);

  function toggleRule(rule: keyof Rules) {
    const settings = game.settings;
    if (!settings) return;
    void game.updateSettings({
      ...settings,
      rules: { ...settings.rules, [rule]: !settings.rules[rule] },
    });
  }

  async function start() {
    try {
      const environment = await api.environment();
      applyEnvironment(environment.platform, environment.material);
      instance = environment.instance;
      game.accent = environment.accent ?? null;
      await game.init();
      void updates.start(environment.updates);
      if (environment.platform === "macos") {
        syncMenu = await installMacMenu({
          newGame: () => void game.newGame(),
          setLevel: (level) => void game.newGame(game.tiling, level),
          customLevel: () => (dialogs.custom = true),
          saves: () => (dialogs.saves = true),
          setTiling: (tiling) => void game.newGame(tiling),
          statistics: () => (dialogs.stats = true),
          toggleSmartClick: () => toggleRule("smartClick"),
          toggleQuestionMarks: () => toggleRule("questionMarks"),
          settings: () => (dialogs.settings = true),
          hint,
          toggleAutoplay,
          togglePause,
          about: () => (dialogs.about = true),
        });
      }
    } catch (error) {
      startupError = t("error.startup", { message: String(error) });
    } finally {
      ready = true;
    }
  }

  let watchingFront: ReturnType<typeof setInterval> | undefined;
  /** Whether the page has focus, by the last focus event. */
  let pageFocused = true;

  function stopWatchingFront() {
    clearInterval(watchingFront);
    watchingFront = undefined;
  }

  /**
   * Pauses once the window is behind another. On Windows a focus loss can
   * come from the page alone: moving or resizing the window takes focus from
   * the page while the window stays in front. Then this checks again until
   * the page has focus back or the window has gone behind.
   */
  async function leaveIfBehind() {
    const inFront = await api.windowInFront();
    // Focus may have come back while the check ran.
    if (pageFocused) return;
    if (!inFront) {
      stopWatchingFront();
      void game.pauseIfPlaying();
      return;
    }
    watchingFront ??= setInterval(() => void leaveIfBehind(), FRONT_CHECK_MS);
  }

  onMount(() => {
    if (!hasShell()) return;
    void start();
    // The window, not the page: grabbing the title bar takes focus from the
    // page but leaves the window focused, and must not pause.
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      pageFocused = focused;
      if (focused) stopWatchingFront();
      else if (game.settings?.pauseOnFocusLoss !== false) void leaveIfBehind();
      // The player may have changed the accent color, or a theme, while away.
      if (focused) {
        void api
          .accent()
          .then((accent) => (game.accent = accent))
          .catch((e: unknown) => console.warn("could not read the accent color", e));
        void game.reloadThemes();
      }
    });
    return () => {
      stopWatchingFront();
      void unlisten.then((stop) => stop());
      game.dispose();
    };
  });

  // Chrome tokens live on <html> so dialogs and the backdrop pick them up too.
  $effect(() => {
    const root = document.documentElement;
    const accent = game.settings?.accentTint === false ? null : game.accent;
    for (const [name, value] of Object.entries(chromeStyle(game.theme, accent))) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    root.dataset.material = game.theme.material;
  });

  // Frosted themes blur what's behind the window; the rest use the default.
  let frosted = false;
  $effect(() => {
    const want = game.theme.material === "frosted";
    if (want === frosted || !hasShell()) return;
    frosted = want;
    void api.setMaterial(want).catch((e: unknown) => {
      // Forget the change, so the next theme switch tries again.
      frosted = !want;
      console.warn("no window material", e);
    });
  });

  // The window's icon takes the theme's colors and follows light or dark mode.
  // Drawing it is async, so only the newest theme's icon is applied.
  let iconRequest = 0;
  $effect(() => {
    const theme = game.theme;
    if (!hasShell()) return;
    const request = ++iconRequest;
    void applyWindowIcon(theme, () => request === iconRequest).catch((e: unknown) =>
      console.warn("no window icon", e),
    );
  });

  // Keep native check marks in step with the game, whichever control changed it.
  $effect(() => {
    syncMenu?.({
      level: game.level,
      tiling: game.tiling,
      smartClick: game.settings?.rules.smartClick ?? true,
      questionMarks: game.settings?.rules.questionMarks ?? true,
      autoplay: game.autoplay,
    });
  });

  // Opening a dialog pauses a game in play, as switching away from the window does.
  $effect(() => {
    if (Object.values(dialogs).some(Boolean)) void game.pauseIfPlaying();
  });

  // A new record opens the champions table on that board with the row marked.
  $effect(() => {
    const over = game.gameOver;
    const rank = over?.championRank;
    if (!over || !rank) return;
    const timer = setTimeout(
      () => {
        champion = { tiling: over.record.tiling, level: over.record.level, rank };
        dialogs.stats = true;
      },
      prefersReducedMotion() ? 0 : RECORD_DELAY_MS,
    );
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!dialogs.stats) champion = null;
  });

  // The window title carries the result, so it shows in the taskbar too. macOS
  // hides the title, and setting it makes AppKit lay out the title bar again,
  // which knocks the traffic lights out of the toolbar.
  $effect(() => {
    if (platform() === "macos") return;
    const outcome = game.gameOver?.record.outcome;
    const base = outcome
      ? t("window.titleResult", { result: t(`window.${outcome}`) })
      : t("app.title");
    const title = instance ? t("window.titleInstance", { title: base, instance }) : base;
    void getCurrentWindow()
      .setTitle(title)
      .catch((e: unknown) => console.warn("could not set the window title", e));
  });

  /**
   * On macOS, H, B, and P are menu shortcuts too, and one press can reach both
   * the menu and the keydown handler. Each action then runs once per press.
   */
  const lastRun: Record<string, number> = {};
  function once(name: string, run: () => void): () => void {
    return () => {
      const now = performance.now();
      if (now - (lastRun[name] ?? -Infinity) < SAME_PRESS_MS) return;
      lastRun[name] = now;
      run();
    };
  }
  const hint = once("hint", () => void game.showHint());
  const toggleAutoplay = once("autoplay", () => game.toggleAutoplay());
  const togglePause = once("pause", () => void game.togglePause());

  /** Esc hides the game at once: pause, then minimize. */
  async function bossKey() {
    await game.pauseIfPlaying();
    await getCurrentWindow()
      .minimize()
      .catch((e: unknown) => console.warn("could not minimize the window", e));
  }

  /**
   * The dialog a key toggles. A key opens its dialog only from outside any
   * dialog, but closes its own dialog from anywhere.
   */
  function dialogFor(event: KeyboardEvent, key: string): Dialog | undefined {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role='menu']")) return undefined;
    const typing = target?.closest("input, select, textarea") && key.length === 1;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    // On macOS the native menu owns Cmd+comma and Cmd+S.
    const chord = platform() !== "macos" && event.ctrlKey && !event.altKey;
    const chordDialog = chord ? CHORD_KEYS[key] : undefined;
    const dialog = chordDialog ?? (plain && !typing ? DIALOG_KEYS[key] : undefined);
    if (!dialog || (!dialogs[dialog] && target?.closest("dialog"))) return undefined;
    return dialog;
  }

  function onKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    const dialog = dialogFor(event, key);
    if (dialog) {
      event.preventDefault();
      dialogs[dialog] = !dialogs[dialog];
      return;
    }
    // Tab can carry focus out of a modal to <body>. Shortcuts stay off then,
    // and Escape still closes the dialog instead of hiding the window.
    if (Object.values(dialogs).some(Boolean)) {
      const outside = !(event.target instanceof Element && event.target.closest("dialog"));
      if (key === "escape" && outside) {
        event.preventDefault();
        for (const name of Object.keys(dialogs) as Dialog[]) dialogs[name] = false;
      }
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("input, select, textarea, dialog, [role='menu']")
    ) {
      return;
    }
    const mod = platform() === "macos" ? event.metaKey : event.ctrlKey;

    // On macOS the native menu owns Cmd shortcuts; elsewhere they land here.
    let action: (() => void) | undefined;
    if (mod && platform() !== "macos") {
      action = { n: () => void game.newGame() }[key];
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const level = LEVELS[Number(key) - 1];
      action = {
        f2: () => void game.newGame(),
        n: () => void game.newGame(),
        h: hint,
        b: toggleAutoplay,
        p: togglePause,
        pause: togglePause,
        escape: () => void bossKey(),
        "+": () => game.zoom("in"),
        "=": () => game.zoom("in"),
        "-": () => game.zoom("out"),
        "*": () => game.zoom("max"),
        "/": () => game.zoom("fit"),
      }[key];
      if (!action && level) action = () => void game.newGame(game.tiling, level);
    }
    if (action) {
      event.preventDefault();
      action();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} oncontextmenu={(e) => e.preventDefault()} />

{#if !hasShell()}
  <main class="message"><p>{t("error.noShell")}</p></main>
{:else if startupError}
  <main class="message" role="alert"><p>{startupError}</p></main>
{:else}
  <div class="app" class:ready class:toolbar-hidden={game.settings?.hideToolbar === true}>
    <TopBar
      onCustomLevel={() => (dialogs.custom = true)}
      onSaves={() => (dialogs.saves = true)}
      onStats={() => (dialogs.stats = true)}
      onSettings={() => (dialogs.settings = true)}
      onAbout={() => (dialogs.about = true)}
    />
    <main class="stage">
      <BoardCanvas />
      <Overlays />
      <UpdateNotice />
    </main>
  </div>

  <CustomLevelDialog bind:open={dialogs.custom} />
  <SavesDialog bind:open={dialogs.saves} />
  <StatsDialog bind:open={dialogs.stats} highlight={champion} />
  <SettingsDialog bind:open={dialogs.settings} />
  <AboutDialog bind:open={dialogs.about} />
{/if}

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .app.ready {
    opacity: 1;
  }

  /* A hidden toolbar slides up, leaving a strip that brings it back on hover
     or focus, so the window still drags and the caption buttons stay reachable. */
  .app.toolbar-hidden {
    grid-template-rows: 0 1fr;
  }

  .app.toolbar-hidden :global(.toolbar) {
    position: relative;
    z-index: 10;
    transform: translateY(calc(6px - 100%));
    background: var(--surface);
    box-shadow: var(--shadow);
    transition: transform 0.15s ease;
  }

  .app.toolbar-hidden :global(.toolbar:hover),
  .app.toolbar-hidden :global(.toolbar:focus-within) {
    transform: none;
  }

  .stage {
    position: relative;
    min-height: 0;
  }

  .message {
    display: grid;
    place-items: center;
    height: 100vh;
    padding: 24px;
    color: var(--text-dim);
    text-align: center;
  }
</style>
