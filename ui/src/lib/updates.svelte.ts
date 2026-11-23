import { api } from "./api";
import type { UpdateInfo, UpdateProgress } from "./bindings";

/** A check for updates the player started from Settings. */
export type CheckStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string }
  | { kind: "failed"; message: string };

/** Where an install the player started has got to. */
export type Installation =
  | { kind: "idle" }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installing" }
  | { kind: "failed"; message: string };

/**
 * Updates as the window sees them. The shell decides whether a check is due
 * and does the downloading; this keeps what the notice and Settings show.
 */
export class UpdateStore {
  /** Whether this copy updates itself; only the player's own installed copy does. */
  supported = $state(false);
  /** The release the last check found. */
  available = $state.raw<UpdateInfo | null>(null);
  /** The player chose Later for the release found. */
  private dismissed = $state(false);
  status = $state.raw<CheckStatus>({ kind: "idle" });
  installation = $state.raw<Installation>({ kind: "idle" });

  /** The release the notice offers, or `null` while there's none or it was put off. */
  get notice(): UpdateInfo | null {
    return this.dismissed ? null : this.available;
  }

  /** Runs the startup check, which the shell skips when it isn't due. */
  async start(supported: boolean): Promise<void> {
    this.supported = supported;
    if (!supported) return;
    try {
      this.found(await api.checkForUpdate(true));
    } catch (error) {
      console.warn("the automatic update check failed", error);
    }
  }

  /** Checks now, from Settings. */
  async check(): Promise<void> {
    this.status = { kind: "checking" };
    try {
      const update = await api.checkForUpdate(false);
      this.found(update);
      this.status = update ? { kind: "available", version: update.version } : { kind: "upToDate" };
    } catch (error) {
      this.status = { kind: "failed", message: String(error) };
    }
  }

  /** Hides the notice until a later check finds the release again. */
  later(): void {
    this.dismissed = true;
  }

  /** Downloads and installs the release. The app restarts into it, so this returns only on failure. */
  async install(): Promise<void> {
    this.installation = { kind: "downloading", percent: null };
    const stop = await api.onUpdateProgress((progress) => this.progress(progress));
    try {
      await api.installUpdate();
    } catch (error) {
      console.warn("the update did not install", error);
      this.installation = { kind: "failed", message: String(error) };
    } finally {
      stop();
    }
  }

  async openNotes(): Promise<void> {
    try {
      await api.openReleaseNotes();
    } catch (error) {
      console.warn("could not open the release notes", error);
    }
  }

  private found(update: UpdateInfo | null) {
    this.available = update;
    if (update) this.dismissed = false;
  }

  private progress(progress: UpdateProgress) {
    if (progress.phase === "installing") {
      this.installation = { kind: "installing" };
      return;
    }
    const { downloaded, total } = progress;
    const percent = total ? Math.min(100, Math.floor((downloaded * 100) / total)) : null;
    this.installation = { kind: "downloading", percent };
  }
}

export const updates = new UpdateStore();
