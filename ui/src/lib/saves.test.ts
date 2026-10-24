import { describe, expect, it } from "vitest";
import { sameSaveName, saveNameProblem } from "./saves";

describe("saveNameProblem", () => {
  it("takes names the shell takes, trimmed", () => {
    expect(saveNameProblem("  Tricky corner ")).toBeNull();
    expect(saveNameProblem("x".repeat(40))).toBeNull();
    expect(saveNameProblem("Ünïcödé 名前")).toBeNull();
  });

  it("names what the shell would refuse", () => {
    expect(saveNameProblem("   ")).toBe("empty");
    expect(saveNameProblem("x".repeat(41))).toBe("long");
    for (const bad of ["a/b", "a\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a|b", "a\u0007b"]) {
      expect(saveNameProblem(bad), bad).toBe("chars");
    }
    expect(saveNameProblem("CON")).toBe("reserved");
    expect(saveNameProblem("lpt9")).toBe("reserved");
    expect(saveNameProblem("com10")).toBeNull();
    expect(saveNameProblem("done.")).toBe("dot");
  });
});

describe("sameSaveName", () => {
  it("ignores case and surrounding space, as the file system does", () => {
    expect(sameSaveName("Corner", " corner ")).toBe(true);
    expect(sameSaveName("Corner", "Corners")).toBe(false);
  });
});
