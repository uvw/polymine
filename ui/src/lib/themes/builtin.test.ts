import { describe, expect, it } from "vitest";
import pane from "../../components/ThemesPane.svelte?raw";
import {
  BUILT_IN_ORDER,
  EDITOR_ORDER,
  EDITOR_COLUMNS,
  EDITOR_THEMES,
  THEME_GRID_COLUMNS,
  editorPlacement,
  themeGroup,
} from "./builtin";
import { BUILT_IN_THEMES } from "./catalog";

describe("themeGroup", () => {
  it("names only built-in themes as editor themes", () => {
    for (const id of EDITOR_THEMES) expect(BUILT_IN_ORDER).toContain(id);
  });

  it("splits the built-in themes between Polymine's own and the editors'", () => {
    const ids = (group: string) =>
      BUILT_IN_THEMES.filter((entry) => themeGroup(entry) === group).map((entry) => entry.id);
    expect(ids("editor")).toEqual(BUILT_IN_ORDER.filter((id) => EDITOR_THEMES.has(id)));
    expect(ids("polymine")).toContain("frost");
    expect(ids("player")).toEqual([]);
  });

  it("puts every player theme in the player group", () => {
    expect(themeGroup({ id: "dracula", builtIn: false })).toBe("player");
  });
});

describe("the Code section's grid", () => {
  const ids = BUILT_IN_THEMES.filter((entry) => themeGroup(entry) === "editor").map((e) => e.id);
  const at = (id: string) => editorPlacement(id);

  it("puts each light theme right under the dark one its column pairs it with", () => {
    for (const [dark, light] of EDITOR_COLUMNS) {
      expect(at(dark).row % 2, dark).toBe(0);
      expect(at(light), light).toEqual({ row: at(dark).row + 1, column: at(dark).column });
    }
  });

  it("fills each row from the left, no wider than the grid", () => {
    const places = EDITOR_ORDER.map(at);
    for (const place of places) expect(place.column).toBeLessThan(THEME_GRID_COLUMNS);
    const key = (p: { row: number; column: number }) => p.row * THEME_GRID_COLUMNS + p.column;
    expect(places.map(key)).toEqual([...places.map(key)].sort((x, y) => x - y));
  });

  it("lists the editor themes in reading order", () => {
    expect(ids).toEqual(EDITOR_ORDER);
    expect(new Set(ids)).toEqual(new Set(EDITOR_COLUMNS.flat()));
  });

  it("matches the column count the Themes page draws", () => {
    expect(pane).toMatch(new RegExp(`\\.theme-grid \\{[^}]*repeat\\(${THEME_GRID_COLUMNS},`));
  });
});

describe("the Themes page's cards", () => {
  // Cards clip their paint to skip off-screen work, so rings must sit inside them.
  it("draws the focus and selection rings inside the card", () => {
    expect(pane).toMatch(/\.card \{[^}]*content-visibility: auto/);
    expect(pane).toMatch(/\.theme:has\(input:focus-visible\) \{[^}]*outline-offset: -\d/);
    expect(pane).toMatch(/\.theme\.on \{[^}]*box-shadow: inset/);
  });
});
