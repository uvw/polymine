import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  warn: vi.fn<(message: string) => Promise<void>>(),
  error: vi.fn<(message: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-log", () => plugin);

const { installLogForwarding } = await import("./log");

let uninstall: () => void;
let consoleWarn: Mock<(...data: unknown[]) => void>;
let consoleError: Mock<(...data: unknown[]) => void>;

beforeEach(() => {
  plugin.warn.mockReset().mockResolvedValue(undefined);
  plugin.error.mockReset().mockResolvedValue(undefined);
  consoleWarn = vi.fn();
  consoleError = vi.fn();
  console.warn = consoleWarn;
  console.error = consoleError;
  uninstall = installLogForwarding();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe("installLogForwarding", () => {
  it("sends console warnings and errors to the log and still prints them", () => {
    console.warn("low on", 3, { cells: [1, 2] });
    expect(consoleWarn).toHaveBeenCalledWith("low on", 3, { cells: [1, 2] });
    expect(plugin.warn).toHaveBeenCalledWith('low on 3 {"cells":[1,2]}');

    const failure = new Error("boom");
    console.error("save failed:", failure);
    expect(consoleError).toHaveBeenCalledWith("save failed:", failure);
    expect(plugin.error.mock.calls[0]?.[0]).toMatch(/^save failed: Error: boom/);
  });

  it("describes values that have no JSON form", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const bare = new Error("no stack");
    bare.stack = undefined;
    console.warn(undefined, cyclic, bare);
    expect(plugin.warn).toHaveBeenCalledWith("undefined [object Object] Error: no stack");
  });

  it("puts the message before a stack that only lists frames", () => {
    const webkit = new TypeError("x is null");
    webkit.stack = "save@tauri://localhost/app.js:1:2";
    console.error(webkit);
    expect(plugin.error).toHaveBeenCalledWith(
      "TypeError: x is null\nsave@tauri://localhost/app.js:1:2",
    );
  });

  it("sends uncaught errors and unhandled rejections", () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "x is not defined",
        filename: "app.js",
        lineno: 4,
        colno: 2,
      }),
    );
    expect(plugin.error).toHaveBeenLastCalledWith("Uncaught at app.js:4:2: x is not defined");

    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    expect(plugin.error).toHaveBeenLastCalledWith("Uncaught: Script error.");

    const rejection = Object.assign(new Event("unhandledrejection"), { reason: "offline" });
    window.dispatchEvent(rejection);
    expect(plugin.error).toHaveBeenLastCalledWith("Unhandled rejection: offline");
  });

  it("installs once", () => {
    expect(installLogForwarding()).toBe(uninstall);
    console.warn("once");
    expect(plugin.warn).toHaveBeenCalledTimes(1);
  });

  it("undoes everything when uninstalled", () => {
    uninstall();
    console.warn("after");
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(consoleWarn).toHaveBeenCalledWith("after");
    expect(plugin.warn).not.toHaveBeenCalled();
    expect(plugin.error).not.toHaveBeenCalled();
  });

  it("survives a log call that throws or rejects", async () => {
    plugin.warn.mockImplementation(() => {
      throw new Error("no plugin");
    });
    expect(() => console.warn("first")).not.toThrow();

    // Vitest fails the run on an unhandled rejection.
    plugin.warn.mockRejectedValue(new Error("ipc down"));
    console.warn("second");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleWarn).toHaveBeenCalledWith("second");
    expect(plugin.error).not.toHaveBeenCalled();
  });

  it("does not loop when logging logs again", () => {
    plugin.error.mockImplementation((message: string) => {
      console.error("while logging", message);
      return Promise.resolve();
    });
    console.error("first");
    expect(plugin.error).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
