import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuiltIns } from "./builtin";
import { svgGlyph, themeEntry } from "./entry";
import { DEFAULT_NUMBERS, VARIABLES } from "./format";
import {
  browserColors,
  defaultColors,
  domColors,
  resolveTheme,
  staticColors,
  type ThemeEnv,
} from "./resolve";

const HEADER = "/*\n * Name: T\n * Author: A\n * Description: D\n * Version: 1\n * Format: 1\n */";
const entry = (body: string, id = "test") => themeEntry(id, `${HEADER}\n:root { ${body} }`, false);
const LIGHT: ThemeEnv = { accent: null, dark: false };

function resolve(body: string, env = LIGHT) {
  const warnings: string[] = [];
  const theme = resolveTheme(entry(body), env, staticColors, (w) => warnings.push(w));
  return { theme, board: theme.board, warnings };
}

afterEach(() => vi.restoreAllMocks());

describe("resolveTheme", () => {
  it("gives a theme that sets nothing the default look, untinted", () => {
    const { theme, board, warnings } = resolve("", { accent: 0xff0000, dark: true });
    expect(warnings).toEqual([]);
    expect(theme).toMatchObject({ scheme: "system", material: "default", chrome: {} });
    expect(board.closed).toBe(0x667089);
    expect(board.closedHover).toBe(0x737e99);
    expect(board.numbers).toHaveLength(DEFAULT_NUMBERS.length);
    expect(board).toMatchObject({ plateAlpha: 1, closedAlpha: 1, openAlpha: 1, sheenAlpha: 0.07 });
  });

  it("follows the system's mode, or the one the theme fixes", () => {
    const body = "--cell-closed: light-dark(#ffffff, #000000);";
    expect(resolve(body, { accent: null, dark: true }).board.closed).toBe(0x000000);
    expect(resolve(body, LIGHT).board.closed).toBe(0xffffff);
    const fixed = resolve(`--color-scheme: dark; ${body}`, LIGHT);
    expect(fixed.theme.scheme).toBe("dark");
    expect(fixed.board.closed).toBe(0x000000);
  });

  it("fills --system-accent when there is one, and the fallback when there isn't", () => {
    const body = "--cell-closed: var(--system-accent, #123456);";
    expect(resolve(body, { accent: 0xabcdef, dark: false }).board.closed).toBe(0xabcdef);
    expect(resolve(body).board.closed).toBe(0x123456);
  });

  it("lets variables refer to each other and to helpers of the theme's own", () => {
    const { board } = resolve("--ink: #102030; --flag: var(--ink); --hint: var(--flag);");
    expect(board.flag).toBe(0x102030);
    expect(board.hint).toBe(0x102030);
  });

  it("reads numbers, lengths, keywords, and fonts", () => {
    const { theme, board, warnings } = resolve(`
      --window-material: frosted; --number-style: colors; --board-plate: none;
      --board-plate-opacity: 15%; --cell-closed-opacity: 0.5; --board-gap: 0;
      --cell-rounding: 1; --mine-spikes: 8; --board-font-weight: bold;
      --board-font: "Comic Neue", cursive; --cell-sheen: rgb(0 0 0 / 20%);
      --number-ring-from: 9;`);
    expect(warnings).toEqual([]);
    expect(theme.material).toBe("frosted");
    expect(board).toMatchObject({
      numberStyle: "colors",
      plate: null,
      plateAlpha: 0.15,
      closedAlpha: 0.5,
      gap: 0,
      rounding: 1,
      mineSpikes: 8,
      fontWeight: "700",
      fontFamily: '"Comic Neue", cursive',
      sheen: 0,
      sheenAlpha: 0.2,
      numberRingFrom: 9,
    });
    expect(resolve("--number-ring-from: none;").board.numberRingFrom).toBeNull();
  });

  it.each([
    ["--board-gap", "3em", 2],
    ["--board-gap", "40px", 2],
    ["--cell-closed-opacity", "150%", 1],
    ["--mine-spikes", "4.5", 4],
    ["--board-font-weight", "650", "700"],
    ["--number-style", "shapes", "digits"],
    ["--number-ring-from", "0", null],
    ["--number-ring-from", "15", null],
    ["--board-font", "rgb(1 2 3)", VARIABLES["--board-font"].fallback],
    ["--board-plate-opacity", "var(--missing)", 1],
  ])("falls back to the default when %s is %s", (name, value, expected) => {
    const { theme, warnings } = resolve(`${name}: ${value};`);
    expect(warnings.length).toBeGreaterThan(0);
    const field = {
      "--board-font": theme.board.fontFamily,
      "--board-gap": theme.board.gap,
      "--cell-closed-opacity": theme.board.closedAlpha,
      "--mine-spikes": theme.board.mineSpikes,
      "--board-font-weight": theme.board.fontWeight,
      "--number-style": theme.board.numberStyle,
      "--number-ring-from": theme.board.numberRingFrom,
      "--board-plate-opacity": theme.board.plateAlpha,
    }[name];
    expect(field).toBe(expected);
  });

  it("reads the light on cells: angles in any unit, the glare's shape, and its opacities", () => {
    const { board, warnings } = resolve(`
      --cell-light-angle: -0.125turn; --cell-rim-angle: 3.14159rad; --cell-gloss-shape: SPOT;
      --cell-gloss-opacity: 60%; --cell-gloss-fade: 0.1; --cell-gloss-extent: 0.4;
      --cell-rim-width: 2px; --cell-shade-depth: 0.7; --number-shadow-opacity: 50%;
      --cell-gloss: #fffaf0; --cell-shade: light-dark(#101010, #000000);
    `);
    expect(warnings).toEqual([]);
    expect(board).toMatchObject({
      lightAngle: 315,
      glossShape: "spot",
      glossAlpha: 0.6,
      glossFade: 0.1,
      glossExtent: 0.4,
      rimWidth: 2,
      shadeDepth: 0.7,
      numberShadowAlpha: 0.5,
      gloss: 0xfffaf0,
      shade: 0x101010,
    });
    expect(board.rimAngle).toBeCloseTo(180, 3);
  });

  it("leaves the light off by default, and refuses an angle without a unit", () => {
    const { board, warnings } = resolve("--cell-light-angle: 15; --cell-gloss-shape: dome;");
    expect(board).toMatchObject({
      lightAngle: 0,
      glossShape: "arc",
      glossAlpha: 0,
      rimAlpha: 0,
      shadeAlpha: 0,
      openShadeAlpha: 0,
      glintAlpha: 0,
      numberShadowAlpha: 0,
    });
    expect(warnings).toHaveLength(2);
    expect(resolve("--cell-light-angle: 0;").board.lightAngle).toBe(0);
  });

  it("picks board effects the app ships, by name and in order", () => {
    expect(resolve("").board.effects).toEqual([]);
    expect(resolve("--board-effects: none;").board.effects).toEqual([]);
    const { board, warnings } = resolve("--board-effects: FerroFluid;");
    expect(warnings).toEqual([]);
    expect(board.effects).toEqual(["ferrofluid"]);
  });

  it("refuses an effect the app doesn't ship, or one named twice", () => {
    for (const value of ["ferrofluid crt", "ferrofluid ferrofluid", "shader.glsl"]) {
      const { board, warnings } = resolve(`--board-effects: ${value};`);
      expect(board.effects, value).toEqual([]);
      expect(warnings, value).toHaveLength(1);
    }
  });

  it("outlines the question mark only when the theme says so", () => {
    expect(resolve("").board.questionOutline).toBeNull();
    const { board, warnings } = resolve("--ink: #101010; --question-outline: var(--ink);");
    expect(warnings).toEqual([]);
    expect(board.questionOutline).toBe(0x101010);
  });

  it("falls back for a color it can't read and drops alpha the board can't use", () => {
    const bad = resolve("--flag: papayawhip;");
    expect(bad.board.flag).toBe(0xff7043);
    expect(bad.warnings).toEqual([expect.stringMatching(/--flag is not a color/)]);
    const seeThrough = resolve("--flag: rgb(255 0 0 / 50%);");
    expect(seeThrough.board.flag).toBe(0xff0000);
    expect(seeThrough.warnings).toEqual([expect.stringMatching(/see-through/)]);
  });

  it("takes the theme's own number colors from --number-1 to the first gap", () => {
    const own = resolve("--number-1: #111111; --number-2: #222222; --number-4: #444444;");
    expect(own.board.numbers).toEqual([0x111111, 0x222222]);
    expect(own.warnings).toEqual([expect.stringMatching(/before --number-3/)]);
    const partial = resolve("--number-2: #222222;");
    expect(partial.board.numbers).toHaveLength(DEFAULT_NUMBERS.length);
    expect(partial.warnings).toEqual([expect.stringMatching(/start at --number-1/)]);
    const fourteen = Array.from({ length: 14 }, (_, i) => `--number-${i + 1}: #0000${10 + i};`);
    expect(resolve(fourteen.join("")).board.numbers).toHaveLength(14);
    const fifteen = resolve(`${fourteen.join("")} --number-15: #000099;`);
    expect(fifteen.board.numbers).toHaveLength(14);
    expect(fifteen.warnings).toEqual([expect.stringMatching(/end at --number-14/)]);
  });

  it("passes chrome tokens on with the theme's own variables filled in", () => {
    const { theme } = resolve(`
      --ink: #eeeeee; --text: var(--ink);
      --accent: var(--system-accent, #00ff00);
      --on-menu-highlight: var(--on-accent);
      --not-chrome: red;`);
    expect(theme.chrome).toEqual({
      "--text": "#eeeeee",
      "--accent": "var(--system-accent, #00ff00)",
      "--on-menu-highlight": "var(--on-accent)",
    });
  });

  it("skips a chrome token caught in a loop", () => {
    const { theme, warnings } = resolve("--a: var(--b); --b: var(--a); --text: var(--a);");
    expect(theme.chrome).toEqual({});
    expect(warnings).toEqual([expect.stringMatching(/--text refers to a variable in a loop/)]);
  });

  it("skips a chrome token whose joined value calls a function themes can't use", () => {
    // The parser refuses this file, so the entry is changed by hand to reach the second check.
    const built = entry("--window-image: none;");
    const declarations = built.sheet.declarations as Map<string, string>;
    declarations.set("--u", "url");
    declarations.set("--window-image", "var(--u)(x.png)");
    const warnings: string[] = [];
    const theme = resolveTheme(built, LIGHT, staticColors, (w) => warnings.push(w));
    expect(theme.chrome["--window-image"]).toBeUndefined();
    expect(warnings).toContain("--window-image builds a call themes can't use");
  });
});

/** The frame the probe lives in, made by a first lookup. */
function probeFrame() {
  domColors(new Map(), [], { dark: false, accent: null });
  const frame = document.querySelector<HTMLIFrameElement>("body > iframe[aria-hidden]");
  if (!frame?.contentWindow) throw new Error("no probe frame");
  return frame;
}

describe("domColors", () => {
  /** Computes colors in the probe's frame the way a browser would, for a few known values. */
  function fakeBrowser(values: Record<string, string>) {
    const view = probeFrame().contentWindow as Window;
    vi.spyOn(view, "getComputedStyle").mockImplementation((element) => {
      const el = element as HTMLElement;
      const name = /^var\((--[\w-]+)\)$/.exec(el.style.color)?.[1];
      const color = name ? (values[name] ?? "rgb(1, 2, 3)") : "rgb(1, 2, 3)";
      return { color } as CSSStyleDeclaration;
    });
  }

  it("reads what the browser computes, and null where the probe kept its parent's color", () => {
    fakeBrowser({ "--a": "color(srgb 1 0 0)", "--b": "rgba(0, 0, 255, 0.5)" });
    const colors = domColors(new Map(), ["--a", "--b", "--c"], { dark: false, accent: null });
    expect(colors.get("--a")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(colors.get("--b")).toEqual({ r: 0, g: 0, b: 255, a: 0.5 });
    expect(colors.get("--c")).toBeNull();
  });

  it("paints colors in other spaces to read them as sRGB", () => {
    fakeBrowser({ "--a": "oklch(0.7 0.1 200)" });
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      getImageData: () => ({ data: [10, 20, 30, 255] }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const colors = domColors(new Map(), ["--a"], { dark: true, accent: 0x123456 });
    expect(colors.get("--a")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(context.fillStyle).toBe("oklch(0.7 0.1 200)");
  });

  it("puts the theme's variables and the accent on a host in a frame of its own", () => {
    const frame = probeFrame();
    domColors(new Map([["--a", "red"]]), [], { dark: true, accent: 0x0000ff });
    const host = frame.contentDocument?.querySelector<HTMLElement>("body > div");
    expect(host?.style.getPropertyValue("--a")).toBe("red");
    expect(host?.style.getPropertyValue("--system-accent")).toBe("#0000ff");
    expect(host?.style.colorScheme).toBe("dark");
  });

  it("is the default only where the browser resolves var() and color-mix()", () => {
    fakeBrowser({});
    expect(defaultColors()).toBe(staticColors);
    fakeBrowser({ "--test": "color(srgb 0.5 0.5 0.5)" });
    expect(defaultColors()).toBe(browserColors);
  });
});

describe("browserColors", () => {
  it("reads what it can itself and asks the browser for the rest", () => {
    const declarations = new Map([
      ["--a", "#102030"],
      ["--b", "oklch(0.7 0.1 200)"],
    ]);
    const asked: string[][] = [];
    vi.spyOn(probeFrame().contentWindow as Window, "getComputedStyle").mockImplementation(
      (element) => {
        const name = /^var\((--[\w-]+)\)$/.exec((element as HTMLElement).style.color)?.[1];
        if (name) asked.push([name]);
        return { color: name ? "rgb(9, 9, 9)" : "rgb(1, 2, 3)" } as CSSStyleDeclaration;
      },
    );
    const colors = browserColors(declarations, ["--a", "--b"], { dark: false, accent: null });
    expect(colors.get("--a")).toEqual({ r: 0x10, g: 0x20, b: 0x30, a: 1 });
    expect(colors.get("--b")).toEqual({ r: 9, g: 9, b: 9, a: 1 });
    expect(asked).toEqual([["--b"]]);
  });
});

describe("svgGlyph", () => {
  it("loads the SVG as a data URL and takes its shape from the viewBox or the size", () => {
    const glyph = svgGlyph('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"/>');
    expect(glyph.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(glyph.aspect).toBe(2);
    expect(svgGlyph("<svg width='10' height='40'></svg>").aspect).toBe(0.25);
    expect(svgGlyph("<svg></svg>").aspect).toBe(1);
  });
});

describe("loadBuiltIns", () => {
  const css = (id: string) => `../../themes/${id}/theme.css`;

  it("reads glyphs and previews from each folder, in the settings order", () => {
    const entries = loadBuiltIns(
      { [css("zeta")]: `${HEADER}:root{}`, [css("graphite")]: `${HEADER}:root{}` },
      {
        "../../themes/graphite/mine.svg": "<svg/>",
        "../../themes/graphite/notes.svg": "<svg/>",
        "../../themes/zeta/flag.svg": "<svg/>",
      },
      { "../../themes/zeta/preview.png": "/assets/zeta.png" },
    );
    expect(entries.map((e) => e.id)).toEqual(["graphite", "zeta"]);
    expect(entries[0]?.glyphNames).toEqual(["mine"]);
    expect(entries[1]?.preview).toBe("/assets/zeta.png");
  });

  it("leaves out a broken folder and logs it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadBuiltIns({ [css("bad")]: ":root{}" }, {}, {})).toEqual([]);
    expect(error).toHaveBeenCalledWith("built-in theme bad is broken:", expect.anything());
  });
});
