import { describe, expect, it } from "vitest";
import { accentTokens, chromeStyle } from "./accent";
import { themeById } from "./catalog";
import { mix } from "./color";

describe("accentTokens", () => {
  it("puts text on the accent that reads on it", () => {
    expect(accentTokens(0x0067c0)["--on-accent"]).toBe("#ffffff");
    expect(accentTokens(0xffd400)["--on-accent"]).toBe("#000000");
    expect(accentTokens(0x0067c0)["--accent"]).toBe("#0067c0");
  });
});

describe("chromeStyle", () => {
  it("lets app.css apply when a system theme has no accent to take", () => {
    const style = chromeStyle(themeById("graphite"), null);
    expect(Object.values(style).every((value) => value === null)).toBe(true);
  });

  it("puts the system accent into a theme that sets no accent of its own", () => {
    const style = chromeStyle(themeById("graphite"), 0x0067c0);
    expect(style["--accent"]).toBe("#0067c0");
    expect(style["--on-accent"]).toBe("#ffffff");
    expect(style["--system-accent"]).toBe("#0067c0");
    expect(style["--surface"]).toBeNull();
  });

  it("keeps a fixed look's own tokens and color scheme", () => {
    const style = chromeStyle(themeById("midnight"), 0x0067c0);
    expect(style["--accent"]).toBe("#36e2c4");
    expect(style["--on-menu-highlight"]).toBe("var(--on-accent)");
    expect(style["--window-image"]).toMatch(/^radial-gradient\(/);
    expect(style["color-scheme"]).toBe("dark");
    expect(style["--system-accent"]).toBe("#0067c0");
  });
});

describe("mix", () => {
  it("moves one color toward another", () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mix(0x000000, 0xff0000, 0.5)).toBe(0x800000);
  });
});
