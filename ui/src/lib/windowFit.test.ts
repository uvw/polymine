import { describe, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => ({
  handler: null as ((event: { payload: { edge: string } }) => void) | null,
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: (_: string, handler: (event: { payload: { edge: string } }) => void) => {
      listen.handler = handler;
      return Promise.resolve(listen.stop);
    },
  }),
  currentMonitor: () => Promise.resolve(null),
}));

const { attachWindowFit, axesOf, fitWindow, placeFitted } = await import("./windowFit");
import type { Frame, Placement, WindowPort } from "./windowZoom";

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

function host(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width });
  Object.defineProperty(el, "clientHeight", { value: height });
  return el;
}

describe("axesOf", () => {
  it("fits a side's width, the top or bottom's height, and both at a corner", () => {
    expect(axesOf("left")).toEqual({ across: true, down: false });
    expect(axesOf("bottom")).toEqual({ across: false, down: true });
    expect(axesOf("topRight")).toEqual({ across: true, down: true });
  });
});

describe("placeFitted", () => {
  it("moves only the edge that was double-clicked", () => {
    expect(placeFitted(frame(), { width: 900, height: 800 }, "right")).toEqual({
      inner: { width: 900, height: 800 },
      position: { x: 500, y: 186 },
    });
    expect(placeFitted(frame(), { width: 900, height: 800 }, "left").position).toEqual({
      x: 600,
      y: 186,
    });
    expect(placeFitted(frame(), { width: 900, height: 700 }, "topLeft").position).toEqual({
      x: 600,
      y: 286,
    });
  });

  it("keeps the minimum size and the work area", () => {
    expect(placeFitted(frame(), { width: 300, height: 5000 }, "bottomRight").inner).toEqual({
      width: 800,
      height: 1200 - 28,
    });
    // Growing to the right past the work area slides the window back inside it.
    expect(placeFitted(frame(), { width: 1900, height: 800 }, "right").position.x).toBe(100);
  });
});

describe("fitWindow", () => {
  function port(read: Frame | null) {
    const applied: Placement[] = [];
    const p: WindowPort = {
      read: () => Promise.resolve(read),
      apply: (placement) => {
        applied.push(placement);
        return Promise.resolve();
      },
    };
    return { p, applied };
  }

  it("changes the window by as much as the board's host changes, in physical pixels", async () => {
    // At twice the density, a 2000 by 1600 window on a 4000 by 2400 work area.
    const { p, applied } = port(
      frame({
        outer: { x: 0, y: 0, width: 2000, height: 1656 },
        inner: { width: 2000, height: 1600 },
        workArea: { x: 0, y: 0, width: 4000, height: 2400 },
        scaleFactor: 2,
      }),
    );
    const fittedHost = vi.fn(() => ({ width: 800, height: 700 }));
    await fitWindow("right", { fittedHost, host: host(900, 700) }, p);
    expect(fittedHost).toHaveBeenCalledWith(true, false);
    expect(applied[0]?.inner).toEqual({ width: 1800, height: 1600 });
  });

  it("leaves a maximized window, or one without a board, alone", async () => {
    const maximized = port(null);
    await fitWindow(
      "left",
      { fittedHost: () => ({ width: 1, height: 1 }), host: host(1, 1) },
      maximized.p,
    );
    const empty = port(frame());
    await fitWindow("left", { fittedHost: () => null, host: host(1, 1) }, empty.p);
    expect([...maximized.applied, ...empty.applied]).toEqual([]);
  });
});

describe("attachWindowFit", () => {
  it("listens for the shell's double clicks until detached", async () => {
    const target = vi.fn(() => null);
    const detach = attachWindowFit(target);
    listen.handler?.({ payload: { edge: "bottom" } });
    expect(target).toHaveBeenCalled();
    detach();
    await vi.waitFor(() => expect(listen.stop).toHaveBeenCalled());
  });
});
