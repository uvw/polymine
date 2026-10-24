import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";

type Send = (message: string) => Promise<void>;

let uninstall: (() => void) | null = null;
let sending = false;

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    // V8 starts the stack with the message; WebKit's stack is only the frames.
    const head = `${value.name}: ${value.message}`;
    if (!value.stack) return head;
    return value.stack.startsWith(head) ? value.stack : `${head}\n${value.stack}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Sends a line to the log file. A failure here is dropped, never logged. */
function send(to: Send, parts: unknown[]) {
  // A console call made while sending would come straight back here.
  if (sending) return;
  sending = true;
  try {
    to(parts.map(describe).join(" ")).catch(() => {});
  } catch {
    // A plugin call that throws instead of rejecting.
  } finally {
    sending = false;
  }
}

/**
 * Copies console warnings and errors, uncaught errors, and unhandled promise
 * rejections to the app's log file, since release builds have no devtools.
 * The console still gets every message. Returns a function that undoes it.
 */
export function installLogForwarding(): () => void {
  if (uninstall) return uninstall;

  const { warn, error } = console;
  console.warn = (...args: unknown[]) => {
    warn.apply(console, args);
    send(logWarn, args);
  };
  console.error = (...args: unknown[]) => {
    error.apply(console, args);
    send(logError, args);
  };

  const onError = (event: ErrorEvent) => {
    const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : "";
    send(logError, [`Uncaught${where}:`, event.error ?? event.message]);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    send(logError, ["Unhandled rejection:", event.reason]);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  uninstall = () => {
    console.warn = warn;
    console.error = error;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    uninstall = null;
  };
  return uninstall;
}
