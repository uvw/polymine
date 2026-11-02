import { describe, expect, it } from "vitest";
import settings from "../../components/SettingsDialog.svelte?raw";
import {
  BUILT_IN_ORDER,
  EDITOR_ORDER,
  EDITOR_COLUMNS,
  EDITOR_THEMES,
  THEME_GRID_COLUMNS,
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

describe("the editor tab's grid", () => {
  const ids = BUILT_IN_THEMES.filter((entry) => themeGroup(entry) === "editor").map((e) => e.id);
  const at = (id: string) => ({
    row: Math.floor(ids.indexOf(id) / THEME_GRID_COLUMNS),
    column: ids.indexOf(id) % THEME_GRID_COLUMNS,
  });

  it("puts each light theme under the dark one its column pairs it with", () => {
    for (const [dark, light] of EDITOR_COLUMNS) {
      expect(at(dark).row, dark).toBe(0);
      expect(at(light), light).toEqual({ row: 1, column: at(dark).column });
    }
  });

  it("puts every dark theme on the first row and every light one on the second", () => {
    const editors = BUILT_IN_THEMES.filter((entry) => themeGroup(entry) === "editor");
    for (const { id, css } of editors) {
      expect(at(id).row, id).toBe(css.includes("--color-scheme: dark") ? 0 : 1);
    }
    expect(ids).toEqual(EDITOR_ORDER);
  });

  it("matches the column count Settings draws", () => {
    expect(settings).toMatch(new RegExp(`\\.theme-grid \\{[^}]*repeat\\(${THEME_GRID_COLUMNS},`));
  });
});
