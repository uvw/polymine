import { describe, expect, it } from "vitest";
import guide from "../../../../docs/themes/creating-a-theme.md?raw";
import { BUILT_IN_ORDER, EXPERIMENTAL_THEMES, RENAMED_BUILT_INS } from "./builtin";
import { BUILT_IN_THEMES, numberColor, themeById } from "./catalog";
import { contrast, cssColor, distance, simulate, type Deficiency } from "./color";
import { countSwatch } from "./counts";
import { COLOR_SEPARATION, DIGIT_SEPARATION, PANE, READABLE, VISIBLE } from "./filter";
import { CHROME_TOKENS, VARIABLES } from "./format";
import { backdrops, bodies } from "./gloss";
import { resolveTheme, staticColors, type ThemeEnv } from "./resolve";
import type { Theme } from "./types";
import { thumbEdge } from "./thumb";

const DEFICIENCIES: Deficiency[] = ["deuteranopia", "protanopia", "tritanopia"];

/** Accent colors Windows offers, the default blue first, picked across the hues. */
const WINDOWS_ACCENTS = [
  0x0078d4, 0x0063b1, 0x8764b8, 0x881798, 0xe3008c, 0xe81123, 0xf7630c, 0xffb900, 0x107c10,
  0x00cc6a, 0x7a7574, 0x4c4a48,
];

/**
 * The accents a theme sees in each mode: macOS's eight, blue, purple, pink,
 * red, orange, yellow, green, and graphite, as `controlAccentColor` gives them
 * in sRGB, and the Windows ones.
 */
const ACCENTS = {
  light: [
    0x007aff,
    0x953d96,
    0xf74f9e,
    0xe0383e,
    0xf7821b,
    0xffc726,
    0x62ba46,
    0x989898,
    ...WINDOWS_ACCENTS,
  ],
  dark: [
    0x007aff,
    0xa550a7,
    0xf74f9e,
    0xff5257,
    0xf7821b,
    0xffc600,
    0x62ba46,
    0x8c8c8c,
    ...WINDOWS_ACCENTS,
  ],
};

/** Every built-in theme is checked in light and dark mode, untinted and with every accent. */
const ENVS: ThemeEnv[] = [false, true].flatMap((dark) => [
  { accent: null, dark },
  ...ACCENTS[dark ? "dark" : "light"].map((accent) => ({ accent, dark })),
]);

/** Experiments skip the readability checks until one ships in a bundled theme. */
const CHECKED = BUILT_IN_THEMES.filter((entry) => !EXPERIMENTAL_THEMES.includes(entry.id));

const resolved: [string, Theme, string[]][] = CHECKED.flatMap((entry) =>
  ENVS.map((env): [string, Theme, string[]] => {
    const warnings: string[] = [];
    const theme = resolveTheme(entry, env, staticColors, (w) => warnings.push(w));
    const accent = env.accent === null ? "" : `, accent ${cssColor(env.accent)}`;
    return [`${entry.id} (${env.dark ? "dark" : "light"}${accent})`, theme, warnings];
  }),
);

/** Least contrast between closed and open cells, shade included. */
function cellMinimum(theme: Theme): number {
  if (theme.relaxed.has("pane-contrast")) return PANE;
  return theme.relaxed.has("cell-contrast") ? 1.4 : VISIBLE;
}

/** `fg` at `alpha` over an opaque `bg`. */
function blend(fg: number, bg: number, alpha: number): number {
  const channel = (shift: number) =>
    Math.round(((fg >> shift) & 255) * alpha + ((bg >> shift) & 255) * (1 - alpha));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

describe.each(resolved)("%s", (_, theme, warnings) => {
  const b = theme.board;

  it("resolves every variable without a warning", () => {
    expect(warnings).toEqual([]);
  });

  it("keeps every number readable on an open cell, wherever its shade falls", () => {
    // Themes that fill cells with color draw no digits on open cells.
    if (b.numberStyle === "colors") return;
    for (const floor of backdrops(b, "open")) {
      for (let n = 1; n <= b.numbers.length; n++) {
        const seen = contrast(numberColor(b, n), floor);
        expect(seen, `number ${n} on ${cssColor(floor)}`).toBeGreaterThanOrEqual(READABLE);
      }
    }
  });

  it("keeps translucent numbers readable over a white or a black desktop", () => {
    if (b.numberStyle === "colors" || b.plateAlpha === 1) return;
    if (theme.relaxed.has("number-readability")) return;
    for (const desktop of [0xffffff, 0x000000]) {
      const plate = blend(b.plate ?? desktop, desktop, b.plateAlpha);
      const open = blend(b.open, plate, b.openAlpha);
      for (let n = 1; n <= b.numbers.length; n++) {
        const seen = contrast(numberColor(b, n), open);
        expect(seen, `number ${n} over ${desktop.toString(16)}`).toBeGreaterThanOrEqual(READABLE);
      }
    }
  });

  it("separates closed cells from open ones, shade included", () => {
    const minimum = cellMinimum(theme);
    for (const tile of bodies(b, "closed")) {
      for (const floor of bodies(b, "open")) {
        const seen = contrast(tile, floor);
        expect(seen, `${cssColor(tile)} on ${cssColor(floor)}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it("keeps the flag visible on a closed cell, by its fill or its outline, glare included", () => {
    for (const tile of backdrops(b, "closed")) {
      const best = Math.max(contrast(b.flag, tile), contrast(b.flagOutline, tile));
      expect(best, `on ${cssColor(tile)}`).toBeGreaterThanOrEqual(VISIBLE);
    }
  });

  it("draws tiling previews with edges that stand out from the cells", () => {
    expect(contrast(thumbEdge(b), b.closed)).toBeGreaterThanOrEqual(VISIBLE);
  });

  it("keeps the question mark visible on a closed cell, shade included", () => {
    // Only the editor themes hold `?` to this bar.
    if (!theme.relaxed.has("pane-contrast")) return;
    for (const tile of backdrops(b, "closed")) {
      const outline = b.questionOutline ?? b.question;
      const best = Math.max(contrast(b.question, tile), contrast(outline, tile));
      expect(best, `on ${cssColor(tile)}`).toBeGreaterThanOrEqual(VISIBLE);
    }
  });

  it("has a full set of distinct number colors", () => {
    // Digits tell every count apart, so 12 colors wrap; a color-only theme
    // gives each count up to 14 a look of its own, a color or a ring.
    const expected = b.numberStyle === "colors" ? 14 : 12;
    expect(b.numbers).toHaveLength(expected);
    const looks = b.numbers.map((_, i) => JSON.stringify(countSwatch(b, i + 1)));
    expect(new Set(looks).size).toBe(expected);
  });
});

describe.each(resolved.filter(([, t]) => !t.relaxed.has("number-separation")))(
  "%s numbers under color vision deficiency",
  (_, theme) => {
    const { numbers } = theme.board;
    const colorOnly = theme.board.numberStyle === "colors";
    const bar = colorOnly ? COLOR_SEPARATION : DIGIT_SEPARATION;
    const visions = colorOnly ? (["normal", ...DEFICIENCIES] as const) : DEFICIENCIES;

    // A ring and a solid fill differ in shape, so only counts drawn alike need apart colors.
    const ringed = numbers.map((_, i) => colorOnly && countSwatch(theme.board, i + 1).ring);

    it.each(visions)(`every count stays ${bar} apart for %s`, (vision) => {
      const seen = numbers.map((c) => (vision === "normal" ? c : simulate(c, vision)));
      seen.forEach((a, i) => {
        seen.slice(i + 1).forEach((b, k) => {
          const j = i + k + 1;
          if (ringed[i] !== ringed[j]) return;
          expect(distance(a, b), `${i + 1} vs ${j + 1}`).toBeGreaterThanOrEqual(bar);
        });
      });
    });
  },
);

describe("built-in theme folders", () => {
  it("load in the settings order, every folder listed", () => {
    expect(BUILT_IN_THEMES.map((e) => e.id)).toEqual([...BUILT_IN_ORDER, ...EXPERIMENTAL_THEMES]);
  });
});

describe("the player's guide", () => {
  it("lists every variable and chrome token", () => {
    for (const name of [...Object.keys(VARIABLES), ...CHROME_TOKENS]) {
      expect(guide, name).toContain(`\`${name}\``);
    }
  });

  it("quotes Graphite's theme.css as it is", () => {
    const graphite = BUILT_IN_THEMES.find((entry) => entry.id === "graphite");
    expect(guide).toContain(graphite?.css.trim());
  });
});

describe("themeById", () => {
  it("falls back to the default for unknown ids", () => {
    expect(themeById("nope").id).toBe("frost");
    expect(themeById(undefined).id).toBe("frost");
  });

  it("opens the theme a renamed built-in id became", () => {
    expect(themeById("velvet").id).toBe("dracula");
    for (const [old, renamed] of RENAMED_BUILT_INS) {
      expect(BUILT_IN_ORDER, old).not.toContain(old);
      expect(themeById(old).id, old).toBe(renamed);
    }
  });

  it("resolves each theme once per accent and mode", () => {
    expect(themeById("graphite")).toBe(themeById("graphite"));
    expect(themeById("graphite", { accent: 0xff0000, dark: false })).not.toBe(
      themeById("graphite"),
    );
  });
});
