import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveInfo } from "../lib/bindings";
import { emptyStats, settings, snapshot } from "../test/fixtures";

const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  newGame: vi.fn(),
  getSettings: vi.fn(),
  tilingPreviews: vi.fn(() => Promise.resolve([])),
  onExternalChange: vi.fn(() => Promise.resolve(() => {})),
  updateSettings: vi.fn(),
  listThemes: vi.fn(() => Promise.resolve({ folder: null, themes: [], skipped: [] })),
  readTheme: vi.fn(),
  openThemesFolder: vi.fn(() => Promise.resolve(null)),
  listSaves: vi.fn((): Promise<SaveInfo[]> => Promise.resolve([])),
  deleteSave: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../lib/api", () => ({ api, hasShell: () => true }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.3") }));

const { game } = await import("../lib/game.svelte");
const { themeEntry } = await import("../lib/themes/entry");
const { default: AboutDialog } = await import("./AboutDialog.svelte");
const { default: CustomLevelDialog } = await import("./CustomLevelDialog.svelte");
const { default: SavesDialog } = await import("./SavesDialog.svelte");
const { default: SettingsDialog } = await import("./SettingsDialog.svelte");
const { default: StatsDialog } = await import("./StatsDialog.svelte");

beforeEach(() => {
  vi.restoreAllMocks();
  game.settings = settings();
  game.snapshot = snapshot();
});

describe("CustomLevelDialog", () => {
  it("starts with the saved custom size and starts a game with the edited one", async () => {
    const user = userEvent.setup();
    const newGame = vi.spyOn(game, "newGame").mockResolvedValue(undefined);
    render(CustomLevelDialog, { props: { open: true } });
    const [cols, rows, mines] = screen.getAllByRole("spinbutton") as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    expect(cols.value).toBe("16");
    await vi.waitFor(() => expect(cols).toHaveFocus());
    await user.clear(mines);
    await user.type(mines, "30");
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(newGame).toHaveBeenCalledWith("square", "custom", { cols: 16, rows: 16, mines: 30 });
    expect(rows).toBeDefined();
  });

  it("flags each invalid field and blocks Start", async () => {
    const user = userEvent.setup();
    render(CustomLevelDialog, { props: { open: true } });
    const [cols, , mines] = screen.getAllByRole("spinbutton") as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    await user.clear(cols);
    await user.type(cols, "1");
    expect(cols).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use 3 to 200.")).toBeInTheDocument();
    // Mines aren't judged while the size itself is wrong.
    expect(mines).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    await user.clear(cols);
    await user.type(cols, "4");
    await user.clear(mines);
    await user.type(mines, "64");
    expect(screen.getByText("Use 1 to 63 mines on this board.")).toBeInTheDocument();
  });

  it("closes on Cancel", async () => {
    const user = userEvent.setup();
    render(CustomLevelDialog, { props: { open: true } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument(),
    );
  });
});

describe("SettingsDialog", () => {
  const open = () => render(SettingsDialog, { props: { open: true } });
  /** Opens Settings and waits for its first tab to take the focus, as it does a tick later. */
  const openSettled = async () => {
    open();
    await vi.waitFor(() => expect(screen.getByRole("tab", { name: "General" })).toHaveFocus());
  };
  const done = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Done" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  it("applies each change as it's made, the name once the field is left", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    open();
    await user.click(screen.getByRole("switch", { name: "Pause when Polymine loses focus" }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ pauseOnFocusLoss: false })),
    );
    await user.click(screen.getByRole("tab", { name: "Themes" }));
    await user.click(screen.getByRole("radio", { name: /Midnight/ }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "midnight" })),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveAccessibleDescription("Your name in the champions table.");
    await user.clear(name);
    await user.type(name, "bob");
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ playerName: "bob" }));
    await user.tab();
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ playerName: "bob" })),
    );
  });

  it("keeps a theme switched while Settings is open, as a rotation does", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    open();
    game.settings = { ...settings(), theme: "dracula", recentThemes: ["dracula"] };
    await user.click(screen.getByRole("switch", { name: "Pause when Polymine loses focus" }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          pauseOnFocusLoss: false,
          theme: "dracula",
          recentThemes: ["dracula"],
        }),
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Themes" }));
    expect(screen.getByRole("radio", { name: "Dracula" })).toBeChecked();
  });

  it("groups settings into sections a keyboard can move through", async () => {
    const user = userEvent.setup();
    open();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["General", "Themes", "Bot"]);
    await vi.waitFor(() => expect(tabs[0]).toHaveFocus());
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("General");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Themes" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Themes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Themes" })).toBeInTheDocument();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("tab", { name: "Bot" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
    await user.keyboard("{End}{ArrowDown}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
    expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it("puts the player, the rules, and the window options under General", () => {
    open();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("General");
    expect(screen.getByRole("combobox", { name: "Player" })).toHaveValue("ann");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Rules",
      "Window",
    ]);
    expect(
      screen.getByRole("switch", { name: "Hide the toolbar until the pointer reaches the top" }),
    ).toBeInTheDocument();
  });

  it("reopens on the section it was closed on", async () => {
    const user = userEvent.setup();
    const view = open();
    await user.click(screen.getByRole("tab", { name: "Bot" }));
    await view.rerender({ open: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await view.rerender({ open: true });
    await vi.waitFor(() => expect(screen.getByRole("tab", { name: "Bot" })).toHaveFocus());
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Bot");
  });

  it("describes rule switches with their help text", () => {
    open();
    const smartClick = screen.getByRole("switch", { name: "Smart click" });
    expect(smartClick).toBeChecked();
    expect(smartClick).toHaveAccessibleDescription(
      "Clicking a number flags its certain mines, then opens the rest.",
    );
  });

  const openThemes = async (user: ReturnType<typeof userEvent.setup>) => {
    open();
    await user.click(screen.getByRole("tab", { name: "Themes" }));
  };
  const radioNames = () => screen.queryAllByRole("radio").map((r) => r.getAttribute("value"));

  it("puts the tint and the color filter above the themes", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    const tint = screen.getByRole("switch", { name: /Tint the theme/ });
    const filter = screen.getByRole("combobox", { name: "Color filter" });
    const search = screen.getByRole("searchbox");
    const first = screen.getByRole("radio", { name: /Graphite/ });
    for (const below of [search, first]) {
      expect(tint.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(filter.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByRole("tab", { name: "Appearance" })).not.toBeInTheDocument();
  });

  it("lists every theme in sections, each with its count", async () => {
    await openThemes(userEvent.setup());
    const signature = screen.getByRole("radiogroup", { name: "Signature" });
    const code = screen.getByRole("radiogroup", { name: "Code" });
    const signatureCount = within(signature).getAllByRole("radio").length;
    expect(screen.getByRole("heading", { name: `Signature ${signatureCount}` })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Code 12" })).toBeVisible();
    expect(within(code).getByRole("radio", { name: /Dracula/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Custom" })).not.toBeInTheDocument();
  });

  it("sets each light editor theme under its dark one, until a filter reflows the grid", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    const card = (name: string) =>
      screen.getByRole("radio", { name }).closest(".card") as HTMLElement;
    expect([card("Dracula").style.gridRow, card("Dracula").style.gridColumn]).toEqual(["1", "2"]);
    expect([card("Alucard").style.gridRow, card("Alucard").style.gridColumn]).toEqual(["2", "2"]);
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(card("Alucard").style.gridRow).toBe("");
  });

  it("searches names, descriptions, and authors, and says when nothing matches", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    const search = screen.getByRole("searchbox", { name: /Search \d+ themes/ });
    await user.type(search, "teal chrome");
    expect(radioNames()).toEqual(["facet"]);
    await user.clear(search);
    await user.type(search, "nothing like this");
    expect(radioNames()).toEqual([]);
    expect(screen.getByText("No themes match.")).toBeVisible();
  });

  it("filters by source and by mode, a pressed chip showing which", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    const code = screen.getByRole("button", { name: "Code" });
    await user.click(code);
    expect(code).toHaveAttribute("aria-pressed", "true");
    expect(radioNames()).toContain("dracula");
    expect(radioNames()).not.toContain("frost");
    const light = screen.getByRole("button", { name: "Light" });
    await user.click(light);
    expect(radioNames()).toContain("alucard");
    expect(radioNames()).not.toContain("dracula");
    await user.click(light);
    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(radioNames()).toContain("dracula");
  });

  it("narrows to black and white themes with the B&W chip", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    const mono = screen.getByRole("button", { name: "B&W" });
    await user.click(mono);
    expect(mono).toHaveAttribute("aria-pressed", "true");
    expect(radioNames()).toContain("datum");
    expect(radioNames()).not.toContain("pride");
    await user.click(mono);
    expect(radioNames()).toContain("pride");
  });

  it("stars favorites and lists only them under Favorites", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openThemes(user);
    const star = screen.getByRole("button", { name: "Favorite Facet" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await user.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ favoriteThemes: ["facet"] }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    expect(radioNames()).toEqual(["facet"]);
    await user.click(screen.getByRole("button", { name: "Favorite Facet" }));
    expect(radioNames()).toEqual([]);
  });

  it("shows the recent themes that still exist, and hides them while filtering", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    game.settings = { ...settings(), recentThemes: ["datum", "gone", "facet"] };
    await openThemes(user);
    const recent = screen.getByRole("group", { name: "Recent" });
    const [first, second, ...rest] = within(recent).getAllByRole("button");
    expect(first).toHaveAccessibleName("Datum");
    expect(second).toHaveAccessibleName("Facet");
    expect(rest).toEqual([]);
    await user.click(within(recent).getByRole("button", { name: "Facet" }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "facet" })),
    );
    await user.type(screen.getByRole("searchbox"), "loop");
    expect(screen.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
  });

  it("picks a different theme from those showing when asked for a surprise", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    await openThemes(user);
    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(screen.getByRole("button", { name: "Surprise me" }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: radioNames()[0] })),
    );
    expect(radioNames()[0]).not.toBe("graphite");
  });

  it("saves which themes a new game may switch to", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openThemes(user);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "New theme each game" }),
      "favorites",
    );
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ themeRotation: "favorites" }),
      ),
    );
  });

  it("shows a theme's name, description, and author in a flyout on hover", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const pride = screen.getByRole("radio", { name: /Pride/ }).closest("label") as HTMLElement;
    await user.hover(pride);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const tip = await vi.waitFor(() => screen.getByRole("tooltip"));
    expect(tip).toHaveTextContent("Pride Colors instead of numbers, cool to hot By Polymine");
    await user.hover(tip);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tip).toBeVisible();
    await user.unhover(tip);
    await vi.waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("shows the flyout on keyboard focus, and Escape closes it before the dialog", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    for (let i = 0; i < 30 && document.activeElement?.getAttribute("type") !== "radio"; i++) {
      await user.tab();
    }
    const first = document.activeElement as HTMLInputElement;
    expect(first).toHaveAttribute("type", "radio");
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).not.toBe(first);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("keeps each theme's description as its radio's accessible description", async () => {
    await openThemes(userEvent.setup());
    const pride = screen.getByRole("radio", { name: /Pride/ });
    expect(pride).toHaveAccessibleDescription("Colors instead of numbers, cool to hot");
    const described = document.getElementById(pride.getAttribute("aria-describedby") ?? "");
    expect(described?.closest("[role=tooltip]")).not.toBeNull();
  });

  it("lists player themes in a section of their own, with their own preview and author", async () => {
    const user = userEvent.setup();
    const css =
      "/* Name: Dusk\n Author: Ann\n Description: Evening colors\n Version: 1\n Format: 1 */ :root {}";
    game.library.user = [themeEntry("dusk", css, false, { preview: "data:image/png;base64,AA==" })];
    game.library.skipped = [{ id: "bad", reason: "it has no theme.css" }];
    const reload = vi.spyOn(game, "reloadThemes").mockResolvedValue(undefined);
    const openFolder = vi.spyOn(game, "openThemesFolder").mockResolvedValue(undefined);
    await openThemes(user);
    expect(reload).toHaveBeenCalled();
    const custom = screen.getByRole("radiogroup", { name: "Custom" });
    const dusk = within(custom).getByRole("radio", { name: /Dusk/ });
    expect(dusk).toHaveAccessibleDescription("Evening colors");
    expect(custom.querySelector("img.preview")).toHaveAttribute(
      "src",
      "data:image/png;base64,AA==",
    );
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(radioNames()).toEqual(["dusk"]);
    await user.hover(dusk.closest("label") as HTMLElement);
    expect(await vi.waitFor(() => screen.getByRole("tooltip"))).toHaveTextContent(
      "Dusk Evening colors By Ann",
    );
    await user.click(screen.getByRole("button", { name: "Open themes folder" }));
    expect(openFolder).toHaveBeenCalled();
    expect(screen.getByRole("list", { name: "Themes that didn't load" })).toHaveTextContent(
      "bad didn't load: it has no theme.css",
    );
    game.library.user = [];
    game.library.skipped = [];
  });

  it("tries a theme on after the pointer rests on its card, until the pointer leaves", async () => {
    const user = userEvent.setup();
    const tryOn = vi.spyOn(game, "tryOn");
    await openThemes(user);
    await user.hover(screen.getByRole("radio", { name: "Facet" }).closest("label") as HTMLElement);
    expect(tryOn).not.toHaveBeenCalledWith("facet");
    await vi.waitFor(() => expect(tryOn).toHaveBeenLastCalledWith("facet"));
    await user.unhover(screen.getByRole("radiogroup", { name: "Signature" }));
    await vi.waitFor(() => expect(tryOn).toHaveBeenLastCalledWith(null));
  });

  it("tries a theme on at once when the keyboard reaches it", async () => {
    const user = userEvent.setup();
    const tryOn = vi.spyOn(game, "tryOn");
    await openThemes(user);
    for (let i = 0; i < 30 && document.activeElement?.getAttribute("type") !== "radio"; i++) {
      await user.tab();
    }
    await user.keyboard("{ArrowRight}");
    const now = document.activeElement as HTMLInputElement;
    expect(tryOn).toHaveBeenLastCalledWith(now.value);
  });

  it("previews with the arrow keys, chooses with Space or Enter, and Escape reverts", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openThemes(user);
    const graphite = screen.getByRole("radio", { name: "Graphite" });
    graphite.focus();
    await user.keyboard("{ArrowRight}");
    const datum = screen.getByRole("radio", { name: "Datum" });
    expect(datum).toHaveFocus();
    expect(datum).not.toBeChecked();
    expect(graphite).toBeChecked();
    expect(game.previewThemeId).toBe("datum");
    await user.keyboard("{ArrowLeft}{ArrowRight}{ArrowRight}");
    const swatch = screen.getByRole("radio", { name: "Swatch" });
    expect(swatch).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(game.previewThemeId).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(swatch).toBeChecked();
    await user.keyboard("{ArrowLeft}");
    await user.keyboard(" ");
    expect(datum).toBeChecked();
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "datum" })),
    );
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ theme: "facet" }));
  });

  it("drops the try-on on Escape before closing, and when the dialog closes", async () => {
    const user = userEvent.setup();
    await openThemes(user);
    game.tryOn("facet");
    const pride = screen.getByRole("radio", { name: "Pride" });
    pride.focus();
    await user.keyboard("{Escape}");
    expect(game.previewThemeId).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    game.tryOn("facet");
    await done(user);
    expect(game.previewThemeId).toBeNull();
  });

  it("offers no Custom chip without player themes", async () => {
    await openThemes(userEvent.setup());
    expect(screen.queryByRole("button", { name: "Custom" })).not.toBeInTheDocument();
  });

  it("saves the color filter and shows it in the theme previews", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openThemes(user);
    const one = () =>
      screen
        .getByRole("radio", { name: /Midnight/ })
        .closest("label")
        ?.querySelector<HTMLElement>('[data-cell="1"]')?.style.color;
    const plain = one();
    expect(plain).toBeTruthy();
    const filter = screen.getByRole("combobox", { name: "Color filter" });
    expect(filter).toHaveValue("off");
    expect(filter).toHaveAccessibleDescription("Shifts board colors for color-blind players.");
    expect(screen.getByRole("option", { name: "Tritanopia (blue-yellow)" })).toBeInTheDocument();
    await user.selectOptions(filter, "deuteranopia");
    expect(one()).not.toBe(plain);
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ colorFilter: "deuteranopia" }),
      ),
    );
  });

  it("enables the idle time only when an idle action is chosen", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    open();
    await user.click(screen.getByRole("tab", { name: "Bot" }));
    const idleTime = screen.getByRole("slider", { name: "Idle time" });
    expect(idleTime).toBeDisabled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "When you're idle" }),
      "autoplay",
    );
    expect(idleTime).toBeEnabled();
    expect(screen.getByText("30 s")).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ assistant: expect.objectContaining({ idleAction: "autoplay" }) }),
      ),
    );
  });

  it("saves the language at once", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    open();
    const select = screen.getByRole("combobox", { name: "Language" });
    expect(select).toHaveValue("system");
    await user.selectOptions(select, "en");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
  });

  it("adds, renames, switches, and removes players", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openSettled();
    const picker = screen.getByRole("combobox", { name: "Player" });
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(picker).toHaveValue("Player 2");
    expect(name).toHaveFocus();
    // The placeholder name is selected, so typing replaces it.
    await user.keyboard("bob");
    await user.tab();
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ playerName: "bob", profiles: ["ann", "bob"] }),
      ),
    );

    await user.selectOptions(picker, "ann");
    expect(name).toHaveValue("ann");
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ playerName: "ann" })),
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ playerName: "bob", profiles: ["bob"] }),
      ),
    );
  });

  it("merges a player renamed to another player's name", async () => {
    const user = userEvent.setup();
    game.settings = settings({ playerName: "bob", profiles: ["ann", "bob"] });
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openSettled();
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "ann");
    await user.tab();
    await vi.waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ playerName: "ann", profiles: ["ann"] }),
      ),
    );
  });

  it("saves a typed name when Done is clicked without leaving the field", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    await openSettled();
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "bob");
    await done(user);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ playerName: "bob" }));
  });

  it("saves a change made just before closing", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings").mockResolvedValue(undefined);
    open();
    await user.click(screen.getByRole("switch", { name: "Pause when Polymine loses focus" }));
    await done(user);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ pauseOnFocusLoss: false }));
  });

  it("saves nothing when only opened and closed", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(game, "updateSettings");
    open();
    await done(user);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("SavesDialog", () => {
  const saved = (name: string, extra: Partial<SaveInfo> = {}): SaveInfo => ({
    name,
    tiling: "hexagon",
    level: "amateur",
    cols: 16,
    rows: 16,
    mines: 40,
    elapsedMs: 187_000,
    savedAt: Date.UTC(2026, 10, 4, 12),
    ...extra,
  });
  const open = () => render(SavesDialog, { props: { open: true } });

  beforeEach(() => {
    game.status = "playing";
    api.listSaves.mockResolvedValue([]);
    game.previews = [{ tiling: "hexagon", polygons: [[{ x: 0, y: 0 }]], complexity: 2 }];
  });

  it("lists the saves with a thumbnail and what each one holds, and says loading assists", async () => {
    api.listSaves.mockResolvedValue([
      saved("Corner"),
      saved("Big", { tiling: "square", level: "custom", cols: 30, rows: 20, mines: 99 }),
    ]);
    open();
    const list = await screen.findByRole("list", { name: "Saved games" });
    const [corner, big] = within(list).getAllByRole("listitem") as [HTMLElement, HTMLElement];
    expect(corner).toHaveTextContent("Corner");
    expect(corner).toHaveTextContent("Hexagons · Amateur");
    expect(corner).toHaveTextContent("3 m 07 s played");
    expect(corner.querySelector("svg")).not.toBeNull();
    expect(big).toHaveTextContent("Custom 30 × 20, 99 mines");
    expect(big.querySelector("svg")).toBeNull();
    expect(screen.getByText(/counts as assisted/)).toBeInTheDocument();
  });

  it("saves the game in play under the typed name, then lists it", async () => {
    const user = userEvent.setup();
    const saveAs = vi.spyOn(game, "saveAs").mockResolvedValue(saved("Corner"));
    open();
    expect(await screen.findByText("No saves yet.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    api.listSaves.mockResolvedValue([saved("Corner")]);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "  Corner {Enter}");
    expect(saveAs).toHaveBeenCalledWith("Corner");
    expect(await screen.findByRole("button", { name: "Load Corner" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("explains a name the shell would refuse and offers to replace a taken one", async () => {
    const user = userEvent.setup();
    api.listSaves.mockResolvedValue([saved("Corner")]);
    open();
    await screen.findByRole("button", { name: "Load Corner" });
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.type(name, "a/b");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription('Leave out < > : " / \\ | ? and *.');
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "corner");
    expect(name).toHaveAccessibleDescription("Replaces the save named Corner.");
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
  });

  it("shows why a save failed inside the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(game, "saveAs").mockImplementation(() => {
      game.error = "Something went wrong: disk full";
      return Promise.resolve(undefined);
    });
    open();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Corner{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("only saves a game in play", async () => {
    game.status = "won";
    open();
    const name = await screen.findByRole("textbox", { name: "Name" });
    expect(name).toBeDisabled();
    expect(name).toHaveAccessibleDescription("Only a game in play can be saved.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("loads a save and closes", async () => {
    const user = userEvent.setup();
    const loadSave = vi.spyOn(game, "loadSave").mockResolvedValue(undefined);
    api.listSaves.mockResolvedValue([saved("Corner")]);
    open();
    await user.click(await screen.findByRole("button", { name: "Load Corner" }));
    expect(loadSave).toHaveBeenCalledWith("Corner");
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Saves" })).not.toBeInTheDocument(),
    );
  });

  it("deletes a save on the second press, and keeps it on Keep", async () => {
    const user = userEvent.setup();
    api.listSaves.mockResolvedValue([saved("Corner")]);
    open();
    await user.click(await screen.findByRole("button", { name: "Delete Corner" }));
    const confirm = screen.getByRole("group", { name: "Delete Corner?" });
    const keep = within(confirm).getByRole("button", { name: "Keep" });
    expect(keep).toHaveFocus();
    await user.click(keep);
    expect(api.deleteSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Corner" }));
    api.listSaves.mockResolvedValue([]);
    await user.click(
      within(screen.getByRole("group", { name: "Delete Corner?" })).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(api.deleteSave).toHaveBeenCalledWith("Corner");
    expect(await screen.findByText("No saves yet.")).toBeInTheDocument();
  });
});

describe("StatsDialog", () => {
  it("loads stats for the current tiling and level, and refetches on change", async () => {
    const user = userEvent.setup();
    api.getStats.mockResolvedValue({
      players: [
        {
          player: "ann",
          games: 4,
          wins: 1,
          avgOpenedPercent: 50,
          avgDurationMs: 9000,
          avgClicks: 12.5,
        },
      ],
      champions: [{ player: "ann", durationMs: 8000, clicks: 10, finishedAt: 1_700_000_000_000 }],
    });
    render(StatsDialog, { props: { open: true } });
    await vi.waitFor(() => expect(api.getStats).toHaveBeenCalledWith("square", "beginner", "ann"));
    expect(await screen.findByText("8.00 s")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tiling" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Hexagons" }));
    await vi.waitFor(() =>
      expect(api.getStats).toHaveBeenLastCalledWith("hexagon", "beginner", "ann"),
    );
    await user.click(screen.getByRole("radio", { name: "All players" }));
    await vi.waitFor(() =>
      expect(api.getStats).toHaveBeenLastCalledWith("hexagon", "beginner", null),
    );
    expect(screen.getByRole("radiogroup", { name: "Whose stats" })).toBeInTheDocument();
  });

  it("reports a stats request that fails", async () => {
    const report = vi.spyOn(game, "reportError").mockImplementation(() => {});
    api.getStats.mockRejectedValue(new Error("history is locked"));
    render(StatsDialog, { props: { open: true } });
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error("history is locked")));
  });

  it("explains an empty table", async () => {
    api.getStats.mockResolvedValue(emptyStats);
    render(StatsDialog, { props: { open: true } });
    expect(await screen.findByText(/No ranked games here yet/)).toBeInTheDocument();
  });

  it("says when nobody has won yet", async () => {
    api.getStats.mockResolvedValue({
      players: [
        {
          player: "ann",
          games: 1,
          wins: 0,
          avgOpenedPercent: 10,
          avgDurationMs: 100,
          avgClicks: 1,
        },
      ],
      champions: [],
    });
    render(StatsDialog, { props: { open: true } });
    expect(await screen.findByText("No wins yet. Be the first.")).toBeInTheDocument();
  });

  it("opens custom games on the beginner tab", async () => {
    api.getStats.mockResolvedValue(emptyStats);
    game.snapshot = snapshot(3, 3, { config: { ...snapshot().config, level: "custom" } });
    render(StatsDialog, { props: { open: true } });
    await vi.waitFor(() => expect(api.getStats).toHaveBeenCalledWith("square", "beginner", "ann"));
  });
});

describe("AboutDialog", () => {
  it("shows the version", async () => {
    render(AboutDialog, { props: { open: true } });
    expect(await screen.findByText("Version 1.2.3")).toBeInTheDocument();
  });
});

describe("Modal", () => {
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(AboutDialog, { props: { open: true } });
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(user).toBeDefined();
  });

  it("stays open when opened again during its close fade", async () => {
    const view = render(AboutDialog, { props: { open: true } });
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    await view.rerender({ open: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await view.rerender({ open: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(dialog.open).toBe(true);
    expect(dialog).not.toHaveClass("closing");
  });

  it("names each open dialog by its own title", () => {
    render(AboutDialog, { props: { open: true } });
    render(CustomLevelDialog, { props: { open: true } });
    expect(screen.getByRole("dialog", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Custom level" })).toBeInTheDocument();
  });
});
