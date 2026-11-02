import { describe, expect, it } from "vitest";
import { FORMAT_VERSION, LIMITS, ThemeError, parseThemeCss } from "./format";

const HEADER = `/*
 * Name: Test
 * Author: Ann <ann@example.com>
 * Description: For the tests
 * Version: 1.2.0
 * Format: 1
 */`;

const sheet = (body: string, header = HEADER, builtIn = false) =>
  parseThemeCss(`${header}\n${body}`, builtIn);
const rejects = (body: string, message: RegExp, header = HEADER) =>
  expect(() => sheet(body, header)).toThrow(message);

describe("parseThemeCss", () => {
  it("reads the header and every variable, the last one winning", () => {
    const parsed = sheet(`
      /* A comment between rules. */
      :root {
        --cell-closed: #123456;
        --board-font: "A; B", 'C', serif; /* a font list */
        --cell-closed: color-mix(in srgb,
          #000000,
          #ffffff 20%);
      }`);
    expect(parsed.meta).toEqual({
      name: "Test",
      author: "Ann <ann@example.com>",
      description: "For the tests",
      version: "1.2.0",
      format: 1,
    });
    expect([...parsed.declarations]).toEqual([
      ["--board-font", `"A; B", 'C', serif`],
      ["--cell-closed", "color-mix(in srgb, #000000, #ffffff 20%)"],
    ]);
    expect(parsed.relaxed.size).toBe(0);
  });

  it("reads relaxed checks only from built-in themes", () => {
    const header = HEADER.replace("*/", "* Relaxed: cell-contrast, number-separation\n */");
    expect(sheet(":root {}", header).relaxed.size).toBe(0);
    expect([...sheet(":root {}", header, true).relaxed]).toEqual([
      "cell-contrast",
      "number-separation",
    ]);
    const unknown = HEADER.replace("*/", "* Relaxed: everything\n */");
    expect(() => sheet(":root {}", unknown, true)).toThrow(/unknown relaxation/);
  });

  it("skips a byte order mark", () => {
    expect(parseThemeCss(`\uFEFF${HEADER}:root{}`).meta.name).toBe("Test");
  });

  it.each(["Name", "Author", "Description", "Version", "Format"])(
    "needs a %s line in the header",
    (key) => {
      const header = HEADER.replace(new RegExp(`\\* ${key}:.*\\n`), "");
      rejects(":root {}", new RegExp(`no ${key} line`), header);
    },
  );

  it("refuses a format it doesn't know", () => {
    rejects(":root {}", /whole number/, HEADER.replace("Format: 1", "Format: one"));
    rejects(
      ":root {}",
      new RegExp(`needs format ${FORMAT_VERSION + 1}`),
      HEADER.replace("Format: 1", `Format: ${FORMAT_VERSION + 1}`),
    );
  });

  it("limits the header's text", () => {
    rejects(":root {}", /name is longer/, HEADER.replace("Name: Test", `Name: ${"x".repeat(41)}`));
  });

  it("needs a header comment first", () => {
    expect(() => parseThemeCss(":root {}")).toThrow(/start with a header/);
  });

  it.each([
    ["another selector", "body { --a: red; }", /one :root/],
    ["a second rule", ":root {} :root {}", /one :root/],
    ["an at-rule", "@import 'x.css'; :root {}", /one :root/],
    ["a real property", ":root { color: red; }", /not a custom property/],
    ["a stray word", ":root { --a: red; oops }", /not a declaration/],
    ["the system accent", ":root { --system-accent: red; }", /set by Polymine/],
    ["an empty value", ":root { --a: ; }", /no value/],
    ["url()", ":root { --a: url(x.png); }", /calls url\(\)/],
    ["URL() in capitals", ":root { --a: URL(x.png); }", /calls URL\(\)/],
    ["image-set()", ':root { --a: image-set("x.png" 1x); }', /calls image-set\(\)/],
    [
      "a call built from a variable",
      ":root { --u: url; --a: var(--u)(x.png); }",
      /parenthesis right after/,
    ],
    ["a name with a digit", ":root { --a: x2(1); }", /calls x2\(\)/],
    ["a name with a non-ASCII letter", ":root { --a: urlé(x); }", /calls urlé\(\)/],
    ["an escape", ":root { --a: u\\72l(x); }", /backslash/],
    ["!important", ":root { --a: red !important; }", /character/],
    ["a brace", ":root { --a: {red}; }", /one :root/],
    ["unbalanced parentheses", ":root { --a: rgb(1 2 3; }", /unbalanced/],
    ["an unclosed comment", ":root { --a: red; /* }", /never closed/],
    ["an unclosed string", ':root { --a: "red; }', /never closed/],
  ])("refuses %s", (_, body, message) => rejects(body, message));

  it("allows parentheses that only group", () => {
    expect(() => sheet(":root { --a: calc((1px + 2px) * 2); --b: min(1px,(2px)); }")).not.toThrow();
  });

  it("limits the file, the variables, and the values", () => {
    expect(() => parseThemeCss(`${HEADER}:root{--a:${"x".repeat(LIMITS.cssBytes)}}`)).toThrow(
      /larger than/,
    );
    // Two bytes each in UTF-8, so under the limit in characters but over it in bytes.
    const accents = `${HEADER}:root{--a:"${"é".repeat(LIMITS.cssBytes / 2)}"}`;
    expect(accents.length).toBeLessThan(LIMITS.cssBytes);
    expect(() => parseThemeCss(accents)).toThrow(/larger than/);
    const many = Array.from({ length: LIMITS.declarations + 1 }, (_, i) => `--v${i}: 1;`);
    rejects(`:root { ${many.join("")} }`, /more than/);
    rejects(`:root { --a: ${"1 ".repeat(LIMITS.valueLength)}; }`, /longer than/);
    rejects(`:root { --${"a".repeat(LIMITS.nameLength)}: 1; }`, /too long a name/);
  });

  it("throws ThemeError, so callers can tell a bad theme from a bug", () => {
    expect(() => parseThemeCss("")).toThrow(ThemeError);
  });
});
