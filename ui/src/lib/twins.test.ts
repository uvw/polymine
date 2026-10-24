import { describe, expect, it } from "vitest";
import ipcThemes from "../../../crates/polymine-ipc/src/themes.rs?raw";
import edgeFit from "../../../src-tauri/src/edge_fit.rs?raw";
import remote from "../../../src-tauri/src/remote.rs?raw";
import settings from "../../../src-tauri/src/settings.rs?raw";
import apiSource from "./api.ts?raw";
import { BUILT_IN_ORDER } from "./themes/builtin";
import { DEFAULT_THEME_ID } from "./themes/catalog";
import { GLYPHS } from "./themes/format";
import { FIT_EVENT } from "./windowFit";

/** The string literals in the value of the Rust constant `name`. */
function rustStrings(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}:`);
  expect(start, `const ${name}`).toBeGreaterThanOrEqual(0);
  const value = source.indexOf("=", start);
  return [...source.slice(value, source.indexOf(";", value)).matchAll(/"([^"]*)"/g)].map(
    (m) => m[1] ?? "",
  );
}

describe("values the UI shares with the Rust side", () => {
  it("lists the same glyphs as polymine-ipc", () => {
    expect(rustStrings(ipcThemes, "GLYPHS")).toEqual([...GLYPHS]);
  });

  it("listens for the shell's fit event", () => {
    expect(rustStrings(edgeFit, "FIT_EVENT")).toEqual([FIT_EVENT]);
  });

  it("listens for the shell's external change event", () => {
    const [event] = rustStrings(remote, "EXTERNAL_EVENT");
    expect(apiSource).toContain(`"${event}"`);
  });

  it("starts on the same default theme as the settings", () => {
    const theme = /theme: "([^"]+)"\.to_owned\(\)/.exec(settings)?.[1];
    expect(theme).toBe(DEFAULT_THEME_ID);
    expect(BUILT_IN_ORDER[0]).toBe(DEFAULT_THEME_ID);
  });
});
