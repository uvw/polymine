import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import MenuButton, { type MenuEntry } from "./MenuButton.svelte";

const text = createRawSnippet(() => ({ render: () => "<span>Open</span>" }));

function setup(entries: MenuEntry[]) {
  const user = userEvent.setup();
  render(MenuButton, { props: { entries, label: "Options", children: text } });
  return { user, trigger: screen.getByRole("button", { name: "Options" }) };
}

afterEach(() => vi.restoreAllMocks());

describe("MenuButton", () => {
  const action = vi.fn();
  const toggle = vi.fn();
  const entries: MenuEntry[] = [
    { kind: "header", label: "Group" },
    { kind: "action", label: "Do it", shortcut: "Ctrl+D", onSelect: action },
    { kind: "separator" },
    { kind: "check", label: "Toggle", checked: true, onSelect: toggle },
    { kind: "radio", label: "Pick", checked: false, onSelect: vi.fn() },
  ];

  it("opens without motion when reduced motion is preferred", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const animate = vi.spyOn(Element.prototype, "animate");
    const { user, trigger } = setup(entries);
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
  });

  it("opens on click and shows every kind of entry", async () => {
    const { user, trigger } = setup(entries);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: /Do it/ })).toHaveTextContent("Ctrl+D");
    expect(screen.getByRole("menuitemcheckbox", { name: "Toggle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Pick" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("Group")).toBeInTheDocument();
  });

  it("runs the entry and closes, returning focus to the button", async () => {
    const { user, trigger } = setup(entries);
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Do it/ }));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports arrow keys, Home, End and Escape", async () => {
    const { user, trigger } = setup(entries);
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const items = [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")];
    await vi.waitFor(() => expect(items[0]).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens at the last item with ArrowUp and closes on Tab", async () => {
    const { user, trigger } = setup(entries);
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    const items = [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")];
    await vi.waitFor(() => expect(items.at(-1)).toHaveFocus());
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when clicking elsewhere", async () => {
    const { user, trigger } = setup(entries);
    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("toggles closed when the button is clicked again", async () => {
    const { user, trigger } = setup(entries);
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape when opened by mouse, without reaching the window", async () => {
    const { user, trigger } = setup(entries);
    const windowKey = vi.fn();
    window.addEventListener("keydown", windowKey);
    await user.click(trigger);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", windowKey);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(windowKey).not.toHaveBeenCalled();
  });

  describe("grid", () => {
    const picked = vi.fn();
    const tiles = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      label: `Tile ${id}`,
      checked: id === "b",
      onSelect: () => picked(id),
    }));
    const gridEntries: MenuEntry[] = [
      { kind: "grid", label: "Tiles", columns: 2, items: tiles },
      { kind: "action", label: "After", onSelect: vi.fn() },
    ];
    const tile = createRawSnippet((id: () => string) => ({
      render: () => `<i data-tile="${id()}"></i>`,
    }));

    function setupGrid() {
      const user = userEvent.setup();
      render(MenuButton, {
        props: { entries: gridEntries, label: "Pick", children: text, tile },
      });
      return { user, trigger: screen.getByRole("button", { name: "Pick" }) };
    }

    it("draws each tile with its picture and picks it", async () => {
      const { user, trigger } = setupGrid();
      await user.click(trigger);
      expect(screen.getByRole("group", { name: "Tiles" })).toBeInTheDocument();
      const b = screen.getByRole("menuitemradio", { name: "Tile b" });
      expect(b).toHaveAttribute("aria-checked", "true");
      expect(b.querySelector("[data-tile='b']")).not.toBeNull();
      await user.click(screen.getByRole("menuitemradio", { name: "Tile d" }));
      expect(picked).toHaveBeenCalledWith("d");
    });

    it("moves by rows with up and down, by tiles with left and right", async () => {
      const { user, trigger } = setupGrid();
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      const name = (n: string) => screen.getByRole("menuitemradio", { name: `Tile ${n}` });
      await vi.waitFor(() => expect(name("a")).toHaveFocus());
      await user.keyboard("{ArrowRight}");
      expect(name("b")).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(name("d")).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(name("c")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(name("a")).toHaveFocus();
      // Past the last row, down leaves the grid; up from the top row wraps.
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "After" })).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(name("e")).toHaveFocus();
    });

    it("keeps the column moving between two grids, as from levels to tilings", async () => {
      const user = userEvent.setup();
      const items = (ids: string[]) =>
        ids.map((id) => ({ id, label: `Tile ${id}`, checked: false, onSelect: vi.fn() }));
      render(MenuButton, {
        props: {
          entries: [
            { kind: "grid", label: "Top", columns: 3, items: items(["x", "y", "z"]) },
            { kind: "grid", label: "Bottom", columns: 2, items: items(["a", "b", "c", "d", "e"]) },
          ],
          label: "Pick",
          children: text,
          tile,
        },
      });
      screen.getByRole("button", { name: "Pick" }).focus();
      await user.keyboard("{ArrowDown}");
      const name = (n: string) => screen.getByRole("menuitemradio", { name: `Tile ${n}` });
      await vi.waitFor(() => expect(name("x")).toHaveFocus());
      await user.keyboard("{ArrowRight}{ArrowDown}");
      expect(name("b")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(name("y")).toHaveFocus();
      // The bottom grid is narrower, so the last column lands on its last one.
      await user.keyboard("{ArrowRight}{ArrowDown}");
      expect(name("b")).toHaveFocus();
      // Up from the top row wraps to the bottom grid's last row.
      await user.keyboard("{ArrowUp}{ArrowLeft}{ArrowUp}");
      expect(name("e")).toHaveFocus();
    });

    it("ignores left and right outside a grid", async () => {
      const { user, trigger } = setupGrid();
      trigger.focus();
      await user.keyboard("{ArrowUp}");
      const after = screen.getByRole("menuitem", { name: "After" });
      await vi.waitFor(() => expect(after).toHaveFocus());
      await user.keyboard("{ArrowLeft}{ArrowRight}");
      expect(after).toHaveFocus();
    });
  });
});
