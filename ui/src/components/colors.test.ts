import { describe, expect, it } from "vitest";

const components = import.meta.glob<string>(["./*.svelte", "../App.svelte"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("chrome colors", () => {
  it("come from CSS tokens, never literals in components", () => {
    for (const [file, source] of Object.entries(components)) {
      const literals = source.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
      expect(literals, file).toEqual([]);
    }
  });
});
