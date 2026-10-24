import { describe, expect, it } from "vitest";
import en from "./en.json";
import {
  LANGUAGES,
  direction,
  language,
  languageName,
  resolveLanguage,
  setLanguage,
  t,
} from "./index";

describe("languages", () => {
  it("picks the first preferred language it has, by full tag and then by base", () => {
    expect(resolveLanguage("system", ["xx-YY", "en-GB"])).toBe("en");
    expect(resolveLanguage("system", ["xx"])).toBe("en");
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("xx")).toBe("en");
  });

  it("falls back to English for unknown codes and names each language", () => {
    setLanguage("xx");
    expect(language()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(languageName("en")).toBe("English");
    expect(LANGUAGES).toContain("en");
  });

  it("sets the text direction from the locale's script", () => {
    setLanguage("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(direction("ar")).toBe("rtl");
    expect(direction("he-IL")).toBe("rtl");
    expect(direction("fa")).toBe("rtl");
    expect(direction("pt-BR")).toBe("ltr");
  });

  it("has every locale use only keys English has", async () => {
    const files = import.meta.glob<Record<string, string>>("./*.json", { import: "default" });
    for (const [file, load] of Object.entries(files)) {
      for (const key of Object.keys(await load())) {
        expect(key in en, `${file}: ${key}`).toBe(true);
      }
    }
  });
});

describe("t", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(t("over.won", { time: "12.00 s" })).toBe("Cleared in 12.00 s");
    expect(t("over.won")).toBe("Cleared in {time}");
  });

  it("has no empty strings", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});

const sources = import.meta.glob<string>(
  ["../../**/*.svelte", "../../**/*.ts", "!../../**/*.test.ts"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

/** Markup outside scripts, styles, comments, and `{...}` expressions. */
function markup(source: string): string {
  let text = source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/\{[^{}]*\}/g, "");
  }
  return text;
}

describe("UI strings", () => {
  it("come from t(), never from literal text in components", () => {
    for (const [file, source] of Object.entries(sources)) {
      if (!file.endsWith(".svelte")) continue;
      const html = markup(source);
      const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? "").trim());
      const attributes = [
        ...html.matchAll(/\b(?:title|aria-label|aria-roledescription|placeholder|alt)="([^"]*)"/g),
      ].map((m) => m[1] ?? "");
      for (const literal of [...texts, ...attributes]) {
        expect(literal, file).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
  });

  it("use keys that exist in en.json", () => {
    const keys = new Set(Object.keys(en));
    for (const [file, source] of Object.entries(sources)) {
      for (const [, key] of source.matchAll(/\bt\("([\w.]+)"/g)) {
        expect(keys.has(key ?? ""), `${file}: ${key}`).toBe(true);
      }
    }
  });
});
