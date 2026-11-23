import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  openReleaseNotes: vi.fn(() => Promise.resolve(null)),
  onUpdateProgress: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../lib/api", () => ({ api, hasShell: () => true }));

const { updates } = await import("../lib/updates.svelte");
const { default: UpdateNotice } = await import("./UpdateNotice.svelte");

beforeEach(async () => {
  vi.clearAllMocks();
  updates.installation = { kind: "idle" };
  api.checkForUpdate.mockResolvedValue({ version: "1.4.0", notes: null, dateMs: null });
  await updates.check();
});

describe("UpdateNotice", () => {
  it("offers the release with its notes, Later, and Install and restart", async () => {
    const user = userEvent.setup();
    render(UpdateNotice);
    expect(screen.getByRole("status")).toHaveTextContent("Polymine 1.4.0 is available");
    await user.click(screen.getByRole("button", { name: "Release notes" }));
    expect(api.openReleaseNotes).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByText("Polymine 1.4.0 is available")).not.toBeInTheDocument();
  });

  it("shows nothing while no release is waiting", () => {
    updates.available = null;
    render(UpdateNotice);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the download's progress and holds the buttons while it installs", async () => {
    const user = userEvent.setup();
    api.installUpdate.mockReturnValue(new Promise(() => {}));
    render(UpdateNotice);
    await user.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(api.installUpdate).toHaveBeenCalled();
    expect(screen.getByText("Downloading the update…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Install and restart" })).not.toBeInTheDocument();

    updates.installation = { kind: "downloading", percent: 42 };
    await vi.waitFor(() => expect(screen.getByText("Downloading the update: 42%")).toBeVisible());
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42");

    updates.installation = { kind: "installing" };
    await vi.waitFor(() =>
      expect(screen.getByText("Installing. Polymine restarts in a moment.")).toBeVisible(),
    );
  });

  it("says why an install failed and offers to try again", async () => {
    const user = userEvent.setup();
    api.installUpdate.mockRejectedValueOnce("could not install the update: disk full");
    render(UpdateNotice);
    await user.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The update didn't install: could not install the update: disk full",
    );
    api.installUpdate.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.installUpdate).toHaveBeenCalledTimes(2);
  });
});
