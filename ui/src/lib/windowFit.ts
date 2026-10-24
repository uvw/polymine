import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  limits,
  tauriWindow,
  type Frame,
  type Placement,
  type Size,
  type WindowPort,
} from "./windowZoom";

/** An edge or corner of the window, as the shell names a double click on it. */
export type Edge =
  "left" | "right" | "top" | "bottom" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** The event the shell sends when an edge or corner is double-clicked. */
export const FIT_EVENT = "fit-window";

/** Which axes an edge fits: a side the width, the top or bottom the height, a corner both. */
export function axesOf(edge: Edge): { across: boolean; down: boolean } {
  return { across: /left|right/i.test(edge), down: /top|bottom/i.test(edge) };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * The window at `inner` size, within its limits, moving only the edges that
 * were double-clicked: the left edge moves for "left", the right one stays.
 * The frame keeps inside the work area, or as far as it already reached past it.
 */
export function placeFitted(frame: Frame, inner: Size, edge: Edge): Placement {
  const { min, max } = limits(frame);
  const { outer, workArea } = frame;
  const width = Math.round(clamp(inner.width, min.width, max.width));
  const height = Math.round(clamp(inner.height, min.height, max.height));
  const outerWidth = width + outer.width - frame.inner.width;
  const outerHeight = height + outer.height - frame.inner.height;
  let x = /left/i.test(edge) ? outer.x + outer.width - outerWidth : outer.x;
  let y = /top/i.test(edge) ? outer.y + outer.height - outerHeight : outer.y;
  if (workArea) {
    const left = Math.min(workArea.x, outer.x);
    const top = Math.min(workArea.y, outer.y);
    const right = Math.max(workArea.x + workArea.width, outer.x + outer.width);
    const bottom = Math.max(workArea.y + workArea.height, outer.y + outer.height);
    x = clamp(x, left, right - outerWidth);
    y = clamp(y, top, bottom - outerHeight);
  }
  return { inner: { width, height }, position: { x, y } };
}

/** What the window fits around: the board, and the element it draws in. */
export interface FitTarget {
  fittedHost(across: boolean, down: boolean): Size | null;
  host: HTMLElement;
}

/** Fits the window to the board along the axes of the double-clicked edge. */
export async function fitWindow(edge: Edge, target: FitTarget, port: WindowPort = tauriWindow) {
  const frame = await port.read();
  if (!frame) return;
  const { across, down } = axesOf(edge);
  const wanted = target.fittedHost(across, down);
  if (!wanted) return;
  // The window keeps whatever it draws around the board, so it changes by
  // as much as the board's host does.
  const k = frame.scaleFactor;
  const inner = {
    width: frame.inner.width + (wanted.width - target.host.clientWidth) * k,
    height: frame.inner.height + (wanted.height - target.host.clientHeight) * k,
  };
  await port.apply(placeFitted(frame, inner, edge));
}

/** Fits the window whenever the shell reports an edge double click. Returns a function that stops. */
export function attachWindowFit(target: () => FitTarget | null): () => void {
  const stop = getCurrentWindow().listen<{ edge: Edge }>(FIT_EVENT, ({ payload }) => {
    const fit = target();
    if (fit)
      void fitWindow(payload.edge, fit).catch((e: unknown) =>
        console.warn("could not fit the window", e),
      );
  });
  return () => void stop.then((unlisten) => unlisten());
}
