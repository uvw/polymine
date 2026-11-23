import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateInfo, UpdateProgress } from "./bindings";

const api = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  openReleaseNotes: vi.fn(),
  onUpdateProgress: vi.fn(),
}));
vi.mock("./api", () => ({ api, hasShell: () => true }));

const { UpdateStore } = await import("./updates.svelte");

const release: UpdateInfo = { version: "1.4.0", notes: "New tilings", dateMs: 1_795_000_000_000 };
let progress: ((progress: UpdateProgress) => void) | null = null;
const stopProgress = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  progress = null;
  api.onUpdateProgress.mockImplementation((handler: (progress: UpdateProgress) => void) => {
    progress = handler;
    return Promise.resolve(stopProgress);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("UpdateStore", () => {
  it("checks on startup only in a copy that updates itself", async () => {
    const off = new UpdateStore();
    await off.start(false);
    expect(api.checkForUpdate).not.toHaveBeenCalled();
    expect(off.supported).toBe(false);

    api.checkForUpdate.mockResolvedValue(release);
    const on = new UpdateStore();
    await on.start(true);
    expect(api.checkForUpdate).toHaveBeenCalledWith(true);
    expect(on.supported).toBe(true);
    expect(on.notice).toEqual(release);
  });

  it("keeps quiet when the startup check finds nothing or fails", async () => {
    api.checkForUpdate.mockResolvedValueOnce(null);
    const store = new UpdateStore();
    await store.start(true);
    expect(store.notice).toBeNull();
    expect(store.status).toEqual({ kind: "idle" });

    api.checkForUpdate.mockRejectedValueOnce("could not check for updates: offline");
    const failing = new UpdateStore();
    await failing.start(true);
    expect(failing.notice).toBeNull();
    expect(failing.status).toEqual({ kind: "idle" });
    expect(console.warn).toHaveBeenCalled();
  });

  it("Later hides the notice until a check finds the release again", async () => {
    api.checkForUpdate.mockResolvedValue(release);
    const store = new UpdateStore();
    await store.start(true);
    store.later();
    expect(store.notice).toBeNull();
    await store.check();
    expect(api.checkForUpdate).toHaveBeenLastCalledWith(false);
    expect(store.notice).toEqual(release);
  });

  it("reports a check by hand: checking, up to date, available, or the error", async () => {
    const store = new UpdateStore();
    await store.start(true);
    let resolve: (value: UpdateInfo | null) => void = () => {};
    api.checkForUpdate.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const checking = store.check();
    expect(store.status).toEqual({ kind: "checking" });
    resolve(null);
    await checking;
    expect(store.status).toEqual({ kind: "upToDate" });

    api.checkForUpdate.mockResolvedValueOnce(release);
    await store.check();
    expect(store.status).toEqual({ kind: "available", version: "1.4.0" });

    api.checkForUpdate.mockRejectedValueOnce("could not check for updates: offline");
    await store.check();
    expect(store.status).toEqual({
      kind: "failed",
      message: "could not check for updates: offline",
    });
  });

  it("follows the download's progress while it installs", async () => {
    api.checkForUpdate.mockResolvedValue(release);
    api.installUpdate.mockReturnValue(new Promise(() => {}));
    const store = new UpdateStore();
    await store.start(true);
    void store.install();
    await vi.waitFor(() => expect(api.installUpdate).toHaveBeenCalled());
    expect(store.installation).toEqual({ kind: "downloading", percent: null });
    progress?.({ phase: "downloading", downloaded: 250, total: 1000 });
    expect(store.installation).toEqual({ kind: "downloading", percent: 25 });
    progress?.({ phase: "downloading", downloaded: 300, total: null });
    expect(store.installation).toEqual({ kind: "downloading", percent: null });
    progress?.({ phase: "installing" });
    expect(store.installation).toEqual({ kind: "installing" });
  });

  it("shows why an install failed and lets the player try again", async () => {
    api.checkForUpdate.mockResolvedValue(release);
    api.installUpdate.mockRejectedValueOnce("could not install the update: disk full");
    const store = new UpdateStore();
    await store.start(true);
    await store.install();
    expect(store.installation).toEqual({
      kind: "failed",
      message: "could not install the update: disk full",
    });
    expect(stopProgress).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();

    api.installUpdate.mockReturnValueOnce(new Promise(() => {}));
    void store.install();
    await vi.waitFor(() =>
      expect(store.installation).toEqual({ kind: "downloading", percent: null }),
    );
  });

  it("opens the release notes and logs a failure", async () => {
    const store = new UpdateStore();
    api.openReleaseNotes.mockResolvedValueOnce(null);
    await store.openNotes();
    expect(api.openReleaseNotes).toHaveBeenCalled();
    api.openReleaseNotes.mockRejectedValueOnce("no browser");
    await store.openNotes();
    expect(console.warn).toHaveBeenCalledWith("could not open the release notes", "no browser");
  });
});
