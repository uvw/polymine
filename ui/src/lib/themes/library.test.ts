import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeList } from "../bindings";

const api = vi.hoisted(() => ({
  listThemes: vi.fn<() => Promise<ThemeList>>(),
  readTheme: vi.fn(),
}));
vi.mock("../api", () => ({ api }));

const { ThemeLibrary } = await import("./library.svelte");
const { BUILT_IN_THEMES } = await import("./catalog");
const { resolveTheme, staticColors } = await import("./resolve");

const css = (name: string, body = "") =>
  `/*\n * Name: ${name}\n * Author: Ann\n * Description: D\n * Version: 1\n * Format: 1\n */\n:root { ${body} }`;

const summary = (id: string, extra: Partial<ThemeList["themes"][number]> = {}) => ({
  id,
  css: css(id),
  preview: null,
  glyphs: [],
  ...extra,
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("built-in themes through the player's path", () => {
  it("load from their folder files and resolve to the same themes as bundled", async () => {
    const svgOf = (src: string) => decodeURIComponent(src.slice(src.indexOf(",") + 1));
    api.listThemes.mockResolvedValue({
      folder: null,
      skipped: [],
      themes: BUILT_IN_THEMES.map((e) => ({
        id: e.id,
        css: e.css,
        preview: e.preview,
        glyphs: [...e.glyphNames],
      })),
    });
    api.readTheme.mockImplementation((id: string) => {
      const bundled = BUILT_IN_THEMES.find((e) => e.id === id);
      const glyphs = Object.entries(bundled?.glyphs ?? {}).map(([name, g]) => ({
        name,
        svg: svgOf(g.src),
      }));
      return Promise.resolve({ id, css: bundled?.css, preview: bundled?.preview, glyphs });
    });
    // No built-ins to collide with, so every folder loads as a player's theme would.
    const library = new ThemeLibrary([]);
    await library.load();
    for (const entry of library.user) await library.loadGlyphs(entry.id);
    expect(library.skipped).toEqual([]);
    expect(library.user.map((e) => e.id)).toEqual(BUILT_IN_THEMES.map((e) => e.id));

    const envs = [
      { accent: null, dark: false },
      { accent: null, dark: true },
      { accent: 0x0078d4, dark: true },
    ];
    BUILT_IN_THEMES.forEach((bundled, i) => {
      const player = library.user[i];
      expect(player?.builtIn).toBe(false);
      for (const env of envs) {
        const expected = resolveTheme(bundled, env, staticColors);
        const actual = resolveTheme(player as typeof bundled, env, staticColors);
        // The test opt-outs are the one difference a built-in may have.
        expect(actual.relaxed.size).toBe(0);
        expect({ ...actual, relaxed: expected.relaxed }).toEqual(expected);
      }
    });
  });
});

describe("ThemeLibrary", () => {
  it("loads player themes and says why others were left out", async () => {
    api.listThemes.mockResolvedValue({
      folder: "/data/themes",
      themes: [
        summary("dusk", { preview: "data:image/png;base64,AA==", glyphs: ["flag", "nope"] }),
        summary("frost"),
        { id: "broken", css: ":root {}", preview: null, glyphs: [] },
      ],
      skipped: [{ id: "Bad", reason: "the folder name must be lowercase" }],
    });
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    expect(library.folder).toBe("/data/themes");
    expect(library.user.map((e) => e.id)).toEqual(["dusk"]);
    expect(library.user[0]).toMatchObject({
      builtIn: false,
      preview: "data:image/png;base64,AA==",
      glyphNames: ["flag"],
    });
    expect(library.skipped).toEqual([
      { id: "Bad", reason: "the folder name must be lowercase" },
      { id: "frost", reason: "a built-in theme has this name" },
      { id: "broken", reason: "theme.css must start with a header comment" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "skipped theme broken: theme.css must start with a header comment",
    );
  });

  it("skips a folder named for a renamed built-in theme", async () => {
    api.listThemes.mockResolvedValue({ folder: null, skipped: [], themes: [summary("velvet")] });
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    expect(library.user).toEqual([]);
    expect(library.skipped).toEqual([{ id: "velvet", reason: "a built-in theme has this name" }]);
  });

  it("keeps the entries of themes that didn't change, and logs a problem once", async () => {
    api.listThemes.mockResolvedValue({
      folder: null,
      themes: [summary("a"), summary("b"), { id: "c", css: "", preview: null, glyphs: [] }],
      skipped: [],
    });
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    const first = library.user;
    const skipped = library.skipped;
    await library.load();
    expect(library.user).toBe(first);
    expect(library.skipped).toBe(skipped);
    expect(warn).toHaveBeenCalledTimes(1);

    api.listThemes.mockResolvedValue({
      folder: null,
      themes: [summary("a"), summary("b", { css: css("b", "--flag: red;") })],
      skipped: [],
    });
    await library.load();
    expect(library.user[0]).toBe(first[0]);
    expect(library.user[1]).not.toBe(first[1]);
  });

  it("keeps what it has when the folder can't be listed", async () => {
    api.listThemes.mockRejectedValue(new Error("disk gone"));
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    expect(library.user).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk gone"));
  });

  it("loads a theme's glyphs once it's chosen, and again only when they change", async () => {
    api.listThemes.mockResolvedValue({
      folder: null,
      themes: [summary("dusk", { glyphs: ["flag", "3"] }), summary("plain")],
      skipped: [],
    });
    const files = {
      id: "dusk",
      css: css("dusk"),
      preview: null,
      glyphs: [
        { name: "flag", svg: "<svg viewBox='0 0 2 1'/>" },
        { name: "3", svg: "<svg/>" },
      ],
    };
    api.readTheme.mockResolvedValue(files);
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    await library.loadGlyphs("plain");
    await library.loadGlyphs(undefined);
    expect(api.readTheme).not.toHaveBeenCalled();

    await library.loadGlyphs("dusk");
    const loaded = library.user[0];
    expect(Object.keys(loaded?.glyphs ?? {}).sort()).toEqual(["3", "flag"]);
    expect(loaded?.glyphs.flag?.aspect).toBe(2);
    await library.loadGlyphs("dusk");
    expect(library.user[0]).toBe(loaded);

    api.readTheme.mockResolvedValue({ ...files, glyphs: [{ name: "flag", svg: "<svg/>" }] });
    await library.loadGlyphs("dusk");
    expect(library.user[0]).not.toBe(loaded);
  });

  it("leaves a theme's glyphs out when its files can't be read or no longer parse", async () => {
    api.listThemes.mockResolvedValue({
      folder: null,
      themes: [summary("dusk", { glyphs: ["flag"] })],
      skipped: [],
    });
    const library = new ThemeLibrary(BUILT_IN_THEMES);
    await library.load();
    const before = library.user[0];
    api.readTheme.mockRejectedValue("there is no theme named dusk");
    await library.loadGlyphs("dusk");
    api.readTheme.mockResolvedValue({ id: "dusk", css: "nope", preview: null, glyphs: [] });
    await library.loadGlyphs("dusk");
    expect(library.user[0]).toBe(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not read theme dusk"));
  });
});
