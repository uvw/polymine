import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** The window as a resize starts, in physical pixels. */
export interface Frame {
  outer: Rect;
  /** The content size, which `setSize` takes. */
  inner: Size;
  /** The monitor's area without the dock, menu bar, or taskbar, when known. */
  workArea: Rect | null;
  scaleFactor: number;
}

export interface Placement {
  inner: Size;
  /** The outer frame's top left. */
  position: { x: number; y: number };
}

export interface WindowPort {
  /** Null when the window must keep its size: maximized or fullscreen. */
  read(): Promise<Frame | null>;
  apply(placement: Placement): Promise<void>;
}

/** The smallest inner size, in logical pixels, as `tauri.conf.json` sets it. */
export const MIN_INNER: Size = { width: 800, height: 600 };
/** Pixels in a wheel line or page, for wheels that report those units. */
const LINE_PX = 40;
const PAGE_PX = 800;
/** A 100 px turn of the plain wheel resizes by 10%. */
const WHEEL_RATE = Math.log(1.1) / 100;
/**
 * A notch is 100 px at Windows' default of three lines a notch, and 333 px
 * at ten. Capping each event keeps a notch to 10% whatever the setting.
 */
const MAX_WHEEL_DELTA = 100;
/** Chromium sends a touchpad pinch as Ctrl and a wheel whose scale is exp(-deltaY / 100). */
const PINCH_DELTA = 100;
/**
 * A Ctrl and mouse wheel notch is 100 px, which would almost triple the
 * window. Capping each event keeps a notch to about 20%; a pinch rarely
 * sends more than this per event.
 */
const MAX_PINCH_DELTA = 20;
/** Input this far apart starts a new resize, from the window's frame then. */
const IDLE_MS = 300;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The wheel's vertical turn in pixels, whatever unit it came in. */
export function wheelPixels(event: Pick<WheelEvent, "deltaY" | "deltaMode">): number {
  const unit = [1, LINE_PX, PAGE_PX][event.deltaMode] ?? 1;
  return event.deltaY * unit;
}

/** The natural log of the resize a wheel event asks for; positive grows. */
export function wheelScale(event: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey">): number {
  const pixels = wheelPixels(event);
  if (!event.ctrlKey) return -clamp(pixels, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA) * WHEEL_RATE;
  return -clamp(pixels, -MAX_PINCH_DELTA, MAX_PINCH_DELTA) / PINCH_DELTA;
}

/** Inner size limits: the window's minimum and the work area less the frame. */
export function limits(frame: Frame): { min: Size; max: Size } {
  const { inner, outer, workArea, scaleFactor } = frame;
  // Neither limit may cut into the size the window already has.
  const min = {
    width: Math.min(MIN_INNER.width * scaleFactor, inner.width),
    height: Math.min(MIN_INNER.height * scaleFactor, inner.height),
  };
  const max = workArea
    ? {
        width: Math.max(workArea.width - (outer.width - inner.width), inner.width),
        height: Math.max(workArea.height - (outer.height - inner.height), inner.height),
      }
    : { width: Infinity, height: Infinity };
  return { min, max };
}

/**
 * The scales worth reaching from `frame`. Below the low end both sides sit at
 * the minimum, and above the high end both fill the work area, so input past
 * either end is dropped rather than stored up.
 */
export function scaleRange(frame: Frame): [number, number] {
  const { min, max } = limits(frame);
  const { width, height } = frame.inner;
  return [
    Math.max(min.width / width, min.height / height),
    Math.max(max.width / width, max.height / height),
  ];
}

/**
 * The window at `scale` times its inner size, around the same center. Each
 * side stops at its own limit, so the aspect ratio holds until one side
 * reaches the minimum or the work area. The frame moves back inside the work
 * area, or as far as it already reached past it.
 */
export function placeAt(frame: Frame, scale: number): Placement {
  const { min, max } = limits(frame);
  const { outer, inner, workArea } = frame;
  const width = Math.round(clamp(inner.width * scale, min.width, max.width));
  const height = Math.round(clamp(inner.height * scale, min.height, max.height));
  const outerWidth = width + outer.width - inner.width;
  const outerHeight = height + outer.height - inner.height;
  let x = Math.round(outer.x + (outer.width - outerWidth) / 2);
  let y = Math.round(outer.y + (outer.height - outerHeight) / 2);
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

/** The Tauri window behind a `WindowPort`. */
export const tauriWindow: WindowPort = {
  async read() {
    const win = getCurrentWindow();
    const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
    if (maximized || fullscreen) return null;
    const [position, outer, inner, scaleFactor, monitor] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.innerSize(),
      win.scaleFactor(),
      currentMonitor(),
    ]);
    const area = monitor?.workArea;
    return {
      outer: { x: position.x, y: position.y, width: outer.width, height: outer.height },
      inner: { width: inner.width, height: inner.height },
      workArea: area
        ? { ...area.position, width: area.size.width, height: area.size.height }
        : null,
      scaleFactor,
    };
  },
  async apply({ inner, position }) {
    const win = getCurrentWindow();
    await Promise.all([
      win.setSize(new PhysicalSize(inner.width, inner.height)),
      win.setPosition(new PhysicalPosition(position.x, position.y)),
    ]);
  },
};

interface Session {
  /** Null while the window can't resize, until the input goes idle. */
  frame: Frame | null;
  range: [number, number];
  scale: number;
}

/**
 * Turns wheel and pinch input into window resizes. Input adds up between
 * animation frames, and one resize at a time goes to the window, so a fast
 * wheel never queues a backlog of resizes.
 */
export class WindowZoom {
  private session: Session | null = null;
  private starting: Promise<void> | null = null;
  /** Log scale received but not yet applied. */
  private pending = 0;
  private applying = false;
  private frameRequested = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly port: WindowPort = tauriWindow,
    private readonly nextFrame: (run: () => void) => void = (run) => requestAnimationFrame(run),
  ) {}

  /** Resizes by `exp(logScale)`; positive grows the window. */
  zoomBy(logScale: number): void {
    if (!Number.isFinite(logScale) || logScale === 0) return;
    this.pending += logScale;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.endSession(), IDLE_MS);
    if (this.session) this.requestFrame();
    else this.starting ??= this.startSession();
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.session = null;
    this.pending = 0;
  }

  private async startSession(): Promise<void> {
    let frame: Frame | null = null;
    try {
      frame = await this.port.read();
    } catch (error) {
      console.warn("could not read the window's frame", error);
    }
    this.session = { frame, range: frame ? scaleRange(frame) : [1, 1], scale: 1 };
    this.starting = null;
    this.requestFrame();
  }

  private endSession(): void {
    // A read or resize still on its way finishes first, so the next session
    // starts from the window as it ends up.
    if (this.applying || this.starting) {
      this.idleTimer = setTimeout(() => this.endSession(), IDLE_MS);
      return;
    }
    this.session = null;
    this.pending = 0;
  }

  private requestFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    this.nextFrame(() => {
      this.frameRequested = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const session = this.session;
    if (!session || this.applying || this.pending === 0) return;
    const [low, high] = session.range;
    const scale = clamp(session.scale * Math.exp(this.pending), low, high);
    this.pending = 0;
    if (!session.frame || scale === session.scale) return;
    session.scale = scale;
    this.applying = true;
    try {
      await this.port.apply(placeAt(session.frame, scale));
    } catch (error) {
      console.warn("could not resize the window", error);
    } finally {
      this.applying = false;
    }
    if (this.pending !== 0) this.requestFrame();
  }
}

/** WebKit's pinch event on macOS; `scale` runs from 1 since the pinch began. */
interface GestureEvent extends UIEvent {
  scale: number;
}

function dialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/**
 * Resizes the window with the wheel and a trackpad pinch over `target`.
 * WKWebView sends a pinch as WebKit gesture events; Chromium, and so WebView2,
 * sends it as a wheel with Ctrl held. Shift and the wheel stay with the board,
 * which scrolls with them. Returns a function that detaches the listeners.
 */
export function attachWindowZoom(target: HTMLElement, zoom = new WindowZoom()): () => void {
  let lastScale = 1;

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || (event.shiftKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (!dialogOpen()) zoom.zoomBy(wheelScale(event));
  };
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    lastScale = 1;
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    const { scale } = event as GestureEvent;
    if (!(scale > 0)) return;
    if (!dialogOpen()) zoom.zoomBy(Math.log(scale / lastScale));
    lastScale = scale;
  };
  const onGestureEnd = (event: Event) => event.preventDefault();

  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("gesturestart", onGestureStart);
  target.addEventListener("gesturechange", onGestureChange);
  target.addEventListener("gestureend", onGestureEnd);
  return () => {
    target.removeEventListener("wheel", onWheel);
    target.removeEventListener("gesturestart", onGestureStart);
    target.removeEventListener("gesturechange", onGestureChange);
    target.removeEventListener("gestureend", onGestureEnd);
    zoom.dispose();
  };
}
