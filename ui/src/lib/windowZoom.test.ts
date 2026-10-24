import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachWindowZoom,
  placeAt,
  scaleRange,
  wheelPixels,
  wheelScale,
  WindowZoom,
  type Frame,
  type Placement,
  type WindowPort,
} from "./windowZoom";

/** A 1000 by 800 window, 28 px of title bar, centered on a 2000 by 1200 work area. */
function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    outer: { x: 500, y: 186, width: 1000, height: 828 },
    inner: { width: 1000, height: 800 },
    workArea: { x: 0, y: 0, width: 2000, height: 1200 },
    scaleFactor: 1,
    ...overrides,
  };
}

function wheel(init: WheelEventInit): WheelEvent {
  return new WheelEvent("wheel", { cancelable: true, ...init });
}

describe("wheelScale", () => {
  it("reads lines and pages as pixels", () => {
    expect(wheelPixels(wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_PIXEL }))).toBe(3);
    expect(wheelPixels(wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }))).toBe(120);
    expect(wheelPixels(wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE }))).toBe(800);
  });

  it("grows by 10% for each 100 px the wheel turns up", () => {
    expect(Math.exp(wheelScale(wheel({ deltaY: -100 })))).toBeCloseTo(1.1);
    expect(Math.exp(wheelScale(wheel({ deltaY: 100 })))).toBeCloseTo(1 / 1.1);
    expect(Math.exp(wheelScale(wheel({ deltaY: -50 })) * 2)).toBeCloseTo(1.1);
  });

  it("caps a notch at 10% when Windows scrolls more lines a notch", () => {
    const tenLines = 1000 / 3;
    expect(Math.exp(wheelScale(wheel({ deltaY: -tenLines })))).toBeCloseTo(1.1);
    expect(Math.exp(wheelScale(wheel({ deltaY: tenLines })))).toBeCloseTo(1 / 1.1);
  });

  it("reads Ctrl and the wheel as Chromium's touchpad pinch", () => {
    expect(
      Math.exp(wheelScale(wheel({ deltaY: -100 * Math.log(1.05), ctrlKey: true }))),
    ).toBeCloseTo(1.05);
  });

  it("caps a Ctrl and mouse wheel notch", () => {
    expect(Math.exp(wheelScale(wheel({ deltaY: -100, ctrlKey: true })))).toBeCloseTo(Math.exp(0.2));
    expect(Math.exp(wheelScale(wheel({ deltaY: 100, ctrlKey: true })))).toBeCloseTo(Math.exp(-0.2));
  });
});

describe("placeAt", () => {
  it("scales around the window's center and keeps the aspect ratio", () => {
    expect(placeAt(frame(), 1.1)).toEqual({
      inner: { width: 1100, height: 880 },
      position: { x: 450, y: 146 },
    });
    expect(placeAt(frame(), 0.9).position).toEqual({ x: 550, y: 226 });
  });

  it("stops each side at the minimum size", () => {
    expect(placeAt(frame(), 0.5).inner).toEqual({ width: 800, height: 600 });
    const wide = frame({
      inner: { width: 1600, height: 800 },
      outer: { ...frame().outer, width: 1600 },
    });
    expect(placeAt(wide, 0.6).inner).toEqual({ width: 960, height: 600 });
  });

  it("scales the minimum by the display's scale factor", () => {
    const retina = frame({
      inner: { width: 2000, height: 1600 },
      outer: { x: 0, y: 0, width: 2000, height: 1656 },
      workArea: null,
      scaleFactor: 2,
    });
    expect(placeAt(retina, 0.1).inner).toEqual({ width: 1600, height: 1200 });
  });

  it("stops each side at the work area, less the title bar", () => {
    expect(placeAt(frame(), 3).inner).toEqual({ width: 2000, height: 1172 });
    expect(placeAt(frame(), 3).position).toEqual({ x: 0, y: 0 });
  });

  it("nudges a window that grows past an edge back on screen", () => {
    const corner = frame({ outer: { x: 1000, y: 372, width: 1000, height: 828 } });
    expect(placeAt(corner, 1.2).position).toEqual({ x: 800, y: 212 });
  });

  it("doesn't pull in a window already past an edge, nor push it further", () => {
    const off = frame({ outer: { x: 1500, y: 186, width: 1000, height: 828 } });
    expect(placeAt(off, 0.9).position.x).toBe(1550);
    // The right edge stays at 2500 instead of reaching 2550.
    expect(placeAt(off, 1.1).position.x).toBe(1400);
  });

  it("never cuts a window already smaller than the minimum or larger than the work area", () => {
    const big = frame({
      inner: { width: 2400, height: 1500 },
      outer: { x: 0, y: 0, width: 2400, height: 1528 },
    });
    expect(placeAt(big, 1).inner).toEqual({ width: 2400, height: 1500 });
    const small = frame({
      inner: { width: 700, height: 500 },
      outer: { x: 0, y: 0, width: 700, height: 528 },
    });
    expect(placeAt(small, 1).inner).toEqual({ width: 700, height: 500 });
  });
});

describe("scaleRange", () => {
  it("ends where both sides reach a limit", () => {
    const [low, high] = scaleRange(frame());
    expect(low).toBeCloseTo(0.8);
    expect(high).toBeCloseTo(2);
  });

  it("has no upper end without a work area", () => {
    expect(scaleRange(frame({ workArea: null }))[1]).toBe(Infinity);
  });
});

/** A port that records each resize, and a frame queue run by hand. */
function harness(read: Frame | null = frame()) {
  const applied: Placement[] = [];
  let finish: (() => void) | null = null;
  const port: WindowPort = {
    read: vi.fn(() => Promise.resolve(read)),
    apply: vi.fn((placement: Placement) => {
      applied.push(placement);
      return new Promise<void>((resolve) => (finish = resolve));
    }),
  };
  const frames: (() => void)[] = [];
  const zoom = new WindowZoom(port, (run) => frames.push(run));
  return {
    port,
    zoom,
    applied,
    /** Runs the queued animation frames and lets the promises settle. */
    async frame() {
      await Promise.resolve();
      for (const run of frames.splice(0)) run();
      await Promise.resolve();
    },
    async finishApply() {
      finish?.();
      finish = null;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("WindowZoom", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one resize per frame for all the input before it", async () => {
    const h = harness();
    h.zoom.zoomBy(Math.log(1.05));
    h.zoom.zoomBy(Math.log(1.05));
    await h.frame();
    expect(h.port.read).toHaveBeenCalledTimes(1);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]?.inner.width).toBe(1103);
  });

  it("holds input while a resize is on its way, then sends it together", async () => {
    const h = harness();
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    h.zoom.zoomBy(Math.log(1.1));
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    expect(h.applied).toHaveLength(1);
    await h.finishApply();
    await h.frame();
    expect(h.applied).toHaveLength(2);
    expect(h.applied[1]?.inner.width).toBe(1331);
  });

  it("measures each resize from the session's first frame", async () => {
    const h = harness();
    h.zoom.zoomBy(Math.log(1.5));
    await h.frame();
    await h.finishApply();
    h.zoom.zoomBy(-Math.log(1.5));
    await h.frame();
    expect(h.applied[1]).toEqual(placeAt(frame(), 1));
  });

  it("drops input past a limit, so turning back responds at once", async () => {
    const h = harness();
    h.zoom.zoomBy(Math.log(0.1));
    await h.frame();
    await h.finishApply();
    expect(h.applied[0]?.inner).toEqual({ width: 800, height: 640 });
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    expect(h.applied[1]?.inner).toEqual({ width: 880, height: 704 });
  });

  it("sends nothing when the input changes nothing", async () => {
    const h = harness();
    h.zoom.zoomBy(0);
    h.zoom.zoomBy(Number.NaN);
    await h.frame();
    expect(h.port.read).not.toHaveBeenCalled();
    h.zoom.zoomBy(Math.log(0.1));
    await h.frame();
    await h.finishApply();
    h.zoom.zoomBy(Math.log(0.5));
    await h.frame();
    expect(h.applied).toHaveLength(1);
  });

  it("reads the frame again once the input goes idle", async () => {
    const h = harness();
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    vi.advanceTimersByTime(400);
    await h.finishApply();
    vi.advanceTimersByTime(400);
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    expect(h.port.read).toHaveBeenCalledTimes(2);
  });

  it("leaves a maximized or fullscreen window alone", async () => {
    const h = harness(null);
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    h.zoom.zoomBy(Math.log(1.1));
    await h.frame();
    expect(h.port.read).toHaveBeenCalledTimes(1);
    expect(h.applied).toHaveLength(0);
  });

  it("logs a failed read or resize and carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const port: WindowPort = {
      read: vi.fn(() => Promise.reject(new Error("gone"))),
      apply: vi.fn(() => Promise.reject(new Error("gone"))),
    };
    const frames: (() => void)[] = [];
    const failing = new WindowZoom(port, (run) => frames.push(run));
    failing.zoomBy(Math.log(1.1));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith("could not read the window's frame", expect.any(Error));

    vi.mocked(port.read).mockResolvedValue(frame());
    failing.dispose();
    failing.zoomBy(Math.log(1.1));
    await Promise.resolve();
    await Promise.resolve();
    for (const run of frames.splice(0)) run();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith("could not resize the window", expect.any(Error));
    warn.mockRestore();
  });
});

describe("attachWindowZoom", () => {
  function attach() {
    const target = document.createElement("div");
    document.body.append(target);
    const zoom = { zoomBy: vi.fn(), dispose: vi.fn() } as unknown as WindowZoom;
    const detach = attachWindowZoom(target, zoom);
    return { target, zoomBy: vi.mocked(zoom.zoomBy), dispose: vi.mocked(zoom.dispose), detach };
  }

  function gesture(type: string, scale: number): Event {
    return Object.assign(new Event(type, { cancelable: true }), { scale });
  }

  afterEach(() => document.body.replaceChildren());

  it("resizes with the plain wheel and with Ctrl and the wheel", () => {
    const { target, zoomBy } = attach();
    const plain = wheel({ deltaY: -100 });
    target.dispatchEvent(plain);
    target.dispatchEvent(wheel({ deltaY: 10, ctrlKey: true }));
    expect(plain.defaultPrevented).toBe(true);
    expect(zoomBy).toHaveBeenNthCalledWith(1, wheelScale(plain));
    expect(zoomBy.mock.calls[1]?.[0]).toBeCloseTo(-0.1);
  });

  it("leaves Shift and the wheel, and a wheel the board took, alone", () => {
    const { target, zoomBy } = attach();
    const shifted = wheel({ deltaY: 30, shiftKey: true });
    target.dispatchEvent(shifted);
    const taken = wheel({ deltaY: 30 });
    taken.preventDefault();
    target.dispatchEvent(taken);
    expect(shifted.defaultPrevented).toBe(false);
    expect(zoomBy).not.toHaveBeenCalled();
  });

  it("resizes with a WebKit pinch by the change in its scale", () => {
    const { target, zoomBy } = attach();
    const start = gesture("gesturestart", 1);
    target.dispatchEvent(start);
    target.dispatchEvent(gesture("gesturechange", 1.2));
    target.dispatchEvent(gesture("gesturechange", 1.5));
    target.dispatchEvent(gesture("gesturechange", 0));
    const end = gesture("gestureend", 1.5);
    target.dispatchEvent(end);
    expect(start.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);
    expect(zoomBy).toHaveBeenCalledTimes(2);
    expect(zoomBy.mock.calls[0]?.[0]).toBeCloseTo(Math.log(1.2));
    expect(zoomBy.mock.calls[1]?.[0]).toBeCloseTo(Math.log(1.25));
  });

  it("does nothing while a dialog is open, but still keeps the page from zooming", () => {
    const { target, zoomBy } = attach();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const event = wheel({ deltaY: -10, ctrlKey: true });
    target.dispatchEvent(event);
    target.dispatchEvent(gesture("gesturestart", 1));
    target.dispatchEvent(gesture("gesturechange", 1.2));
    expect(event.defaultPrevented).toBe(true);
    expect(zoomBy).not.toHaveBeenCalled();
  });

  it("detaches its listeners", () => {
    const { target, zoomBy, dispose, detach } = attach();
    detach();
    target.dispatchEvent(wheel({ deltaY: -100 }));
    target.dispatchEvent(gesture("gesturechange", 1.2));
    expect(zoomBy).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
});
