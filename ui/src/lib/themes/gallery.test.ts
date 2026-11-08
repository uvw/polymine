import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES } from "./catalog";
import { themeEntry } from "./entry";
import {
  filterThemes,
  gallerySections,
  isMonochrome,
  isSeeThrough,
  knownIds,
  pickTheme,
  rotationPool,
  themeMode,
  type GalleryFilter,
} from "./gallery";

const player = themeEntry(
  "dusk",
  `/*
 * Name: Dusk
 * Author: Ann Example
 * Description: Warm evening tiles
 * Version: 1.0.0
 * Format: 1
 */
:root { --color-scheme: dark; }`,
  false,
);
const ALL = [...BUILT_IN_THEMES, player];
const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);
const filter = (over: Partial<GalleryFilter>): GalleryFilter => ({
  query: "",
  source: "all",
  mode: null,
  mono: false,
  seeThrough: false,
  favorites: [],
  ...over,
});

describe("themeMode", () => {
  it("reads the theme's color scheme", () => {
    const byId = (id: string) => ALL.find((entry) => entry.id === id) ?? player;
    expect(themeMode(byId("datum"))).toBe("dark");
    expect(themeMode(byId("elevation"))).toBe("light");
    expect(themeMode(byId("frost"))).toBe("both");
  });
});

describe("isMonochrome", () => {
  it("finds the black and white themes: gray cells and near-gray inks", () => {
    const mono = BUILT_IN_THEMES.filter(isMonochrome).map((entry) => entry.id);
    expect(mono.sort()).toEqual(["datum", "elevation", "interference", "umbra"]);
  });
});

describe("isSeeThrough", () => {
  it("finds the themes the desktop shows through", () => {
    const glass = BUILT_IN_THEMES.filter(isSeeThrough).map((entry) => entry.id);
    expect(glass.sort()).toEqual(["frost", "glass"]);
  });
});

describe("filterThemes", () => {
  it("keeps every theme for an empty filter", () => {
    expect(ids(filterThemes(ALL, filter({})))).toEqual(ids(ALL));
  });

  it("matches every word of the query against name, description, and author", () => {
    expect(ids(filterThemes(ALL, filter({ query: "Teal  CHROME" })))).toEqual(["facet"]);
    expect(ids(filterThemes(ALL, filter({ query: "ann example" })))).toEqual(["dusk"]);
    expect(ids(filterThemes(ALL, filter({ query: "polymine" })))).toEqual(
      expect.arrayContaining(
        ids(BUILT_IN_THEMES.filter((entry) => entry.sheet.meta.author === "Polymine")),
      ),
    );
    expect(filterThemes(ALL, filter({ query: "nothing like this" }))).toEqual([]);
  });

  it("keeps one source, or the favorites", () => {
    expect(ids(filterThemes(ALL, filter({ source: "player" })))).toEqual(["dusk"]);
    expect(ids(filterThemes(ALL, filter({ source: "editor" })))).toContain("dracula");
    expect(ids(filterThemes(ALL, filter({ source: "polymine" })))).not.toContain("dracula");
    expect(
      ids(filterThemes(ALL, filter({ source: "favorites", favorites: ["loop", "dusk"] }))),
    ).toEqual(["loop", "dusk"]);
  });

  it("keeps only see-through themes when asked", () => {
    expect(ids(filterThemes(ALL, filter({ seeThrough: true }))).sort()).toEqual(["frost", "glass"]);
  });

  it("keeps only black and white themes when asked", () => {
    expect(ids(filterThemes(ALL, filter({ mono: true }))).sort()).toEqual([
      "datum",
      "elevation",
      "interference",
      "umbra",
    ]);
  });

  it("keeps themes that show the mode, both-mode themes included", () => {
    const light = ids(filterThemes(ALL, filter({ mode: "light" })));
    expect(light).toContain("elevation");
    expect(light).toContain("frost");
    expect(light).not.toContain("datum");
  });
});

describe("gallerySections", () => {
  it("orders Signature, Code, then the player's, and drops empty groups", () => {
    const sections = gallerySections(ALL);
    expect(sections.map((s) => s.group)).toEqual(["polymine", "editor", "player"]);
    expect(ids(sections[2]?.themes ?? [])).toEqual(["dusk"]);
    expect(gallerySections([player]).map((s) => s.group)).toEqual(["player"]);
  });
});

describe("knownIds", () => {
  it("drops ids with no theme and keeps the order", () => {
    expect(knownIds(ALL, ["loop", "gone", "datum"])).toEqual(["loop", "datum"]);
  });
});

describe("rotationPool", () => {
  it("draws from two or more favorites, else from every theme", () => {
    expect(ids(rotationPool(ALL, "favorites", ["loop", "datum"]))).toEqual(["datum", "loop"]);
    expect(ids(rotationPool(ALL, "favorites", ["loop", "gone"]))).toEqual(ids(ALL));
    expect(ids(rotationPool(ALL, "all", ["loop", "datum"]))).toEqual(ids(ALL));
    expect(rotationPool(ALL, "off", [])).toEqual([]);
  });
});

describe("pickTheme", () => {
  it("never picks the current theme", () => {
    const pool = ALL.filter((entry) => ["loop", "datum"].includes(entry.id));
    for (const roll of [0, 0.5, 0.99]) expect(pickTheme(pool, "loop", () => roll)).toBe("datum");
  });

  it("follows the random source", () => {
    const pool = ALL.filter((entry) => ["loop", "datum", "facet"].includes(entry.id));
    expect(pickTheme(pool, "loop", () => 0)).toBe("datum");
    expect(pickTheme(pool, "loop", () => 0.99)).toBe("facet");
  });

  it("returns null when nothing else is in the pool", () => {
    const pool = ALL.filter((entry) => entry.id === "loop");
    expect(pickTheme(pool, "loop")).toBeNull();
    expect(pickTheme([], "loop")).toBeNull();
  });
});
