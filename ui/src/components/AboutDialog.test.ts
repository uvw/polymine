import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.3") }));

const { default: AboutDialog } = await import("./AboutDialog.svelte");

describe("AboutDialog", () => {
  it("opens and closes the third-party notices", async () => {
    const user = userEvent.setup();
    render(AboutDialog, { props: { open: true } });
    const button = screen.getByRole("button", { name: "Third-party notices" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const notices = await screen.findByRole("region", { name: "Third-party notices" });
    await vi.waitFor(() => expect(notices.textContent).toContain("pixi.js"));
    expect(notices.textContent).toContain("option-ext");
    expect(notices.textContent).toContain("https://crates.io/crates/option-ext/");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Third-party notices" })).toBeNull();
  });

  it("hides the notices once the dialog closes", async () => {
    const user = userEvent.setup();
    const view = render(AboutDialog, { props: { open: true } });
    await user.click(screen.getByRole("button", { name: "Third-party notices" }));
    await view.rerender({ open: false });
    await view.rerender({ open: true });
    expect(screen.getByRole("button", { name: "Third-party notices" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
