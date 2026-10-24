import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fake from "../../test/fakePixi";
import { snapshot } from "../../test/fixtures";
import { themeById } from "../themes/catalog";
import { svgGlyph } from "../themes/entry";

vi.mock("pixi.js/unsafe-eval", () => ({}));
vi.mock("pixi.js", () => fake);

const { BoardView } = await import("./BoardView");

/** The private state the tests look at. */
interface Internals {
  app: fake.Application;
  cells: {
    root: fake.Container;
    shape: fake.Graphics;
    glyph: fake.Container;
    glyphRoot: fake.Container | null;
    pressed: boolean;
  }[];
  contexts: Map<string, fake.GraphicsContext>;
  viewport: fake.Container;
  cellLayer: fake.Container;
  overlayLayer: fake.Container;
  glint: { band: fake.Graphics } | null;
  fxLayer: fake.Container;
  pan: { x: number; y: number; minX: number; minY: number };
  shake: { time: number };
  focus: { cell: number } | null;
}

const theme = themeById("graphite").board;
let reducedMotion = false;
/** Change listeners on each media query the view watches. */
const media = new Map<string, Set<() => void>>();
function listeners(query: string) {
  let set = media.get(query);
  if (!set) media.set(query, (set = new Set()));
  return set;
}
const listening = () => [...media.values()].reduce((n, set) => n + set.size, 0);

function host(width: number, height: number) {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  return el;
}

async function setup(width = 400, height = 400, cols = 3, rows = 3, board = theme) {
  const handlers = {
    primary: vi.fn(),
    secondary: vi.fn(),
    fieldSecondary: vi.fn(),
    pointerPress: vi.fn(),
    layoutChanged: vi.fn(),
    inspect: vi.fn(),
  };
  const view = await BoardView.create(host(width, height), board, handlers);
  view.load(snapshot(cols, rows));
  const internals = view as unknown as Internals;
  /** Runs frames until the ticker stops itself or the limit is hit. */
  const settle = (frames = 200) => {
    for (let i = 0; i < frames && internals.app.ticker.step(16); i++);
  };
  const cell = (i: number) => internals.cells[i] as Internals["cells"][number];
  return { view, internals, handlers, settle, cell };
}

beforeEach(() => {
  reducedMotion = false;
  media.clear();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("reduced-motion") && reducedMotion,
        addEventListener: (_: string, fn: () => void) => listeners(query).add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners(query).delete(fn),
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => vi.restoreAllMocks());

describe("layout", () => {
  it("creates one interactive sprite per cell", async () => {
    const { internals } = await setup();
    expect(internals.cells).toHaveLength(9);
    expect(internals.cellLayer.children[0]?.children).toHaveLength(9);
    expect(internals.cells[0]?.root.eventMode).toBe("static");
  });

  it("shares drawings between cells with the same shape and state", async () => {
    const before = fake.GraphicsContext.created;
    const { internals, cell } = await setup(400, 400, 6, 6);
    // 36 squares, all closed: one shape, one state, and no empty drawing per cell.
    expect(internals.contexts.size).toBe(1);
    expect(fake.GraphicsContext.created - before).toBe(1);
    expect(cell(35).shape.context).toBe([...internals.contexts.values()][0]);
  });

  it("splits a large board into render groups", async () => {
    const { internals } = await setup(200, 200, 40, 40);
    const groups = internals.cellLayer.children;
    expect(groups.map((group) => group.children.length)).toEqual([1024, 576]);
    expect(groups.every((group) => group.isRenderGroup)).toBe(true);
  });

  it("frees the shared drawings before the cells that use them", async () => {
    const { view, internals } = await setup();
    const contexts = [...internals.contexts.values()];
    const [group] = internals.cellLayer.children;
    let freedFirst = false;
    if (group) group.destroy = () => void (freedFirst = contexts.every((c) => c.destroyed));
    view.setTheme(theme);
    expect(freedFirst).toBe(true);
  });

  it("scrolls instead of shrinking cells below the minimum size", async () => {
    const { internals } = await setup(200, 200, 40, 40);
    expect(internals.pan.minX).toBeLessThan(0);
    expect(internals.pan.minY).toBeLessThan(0);
  });

  it("sizes the host to fit the board along the asked axes", async () => {
    // A 3 by 3 board of squares in a 600 by 400 host: the height limits it.
    const { view } = await setup(600, 400, 3, 3);
    const both = view.fittedHost(true, true);
    expect(both?.height).toBeCloseTo(400);
    expect(both?.width).toBeCloseTo(400);
    expect(view.fittedHost(true, false)).toEqual(both);
    // Down alone takes the height the board has at the width's scale.
    expect(view.fittedHost(false, true)?.height).toBeCloseTo(600);
    expect(view.fittedHost(false, true)?.width).toBe(600);
  });

  it("fits small boards without scrolling", async () => {
    const { internals } = await setup();
    expect(internals.pan.minX).toBe(0);
    expect(internals.pan.minY).toBe(0);
  });

  it("reports cell anchors that follow scrolling", async () => {
    const { view, internals } = await setup(200, 200, 40, 40);
    const before = view.anchorOf(0);
    internals.app.canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 50, shiftKey: true, cancelable: true }),
    );
    expect(view.anchorOf(0)?.y).toBe((before?.y ?? 0) - 50);
    expect(view.anchorOf(9999)).toBeNull();
  });

  it("clamps scrolling to the board", async () => {
    const { internals } = await setup(200, 200, 40, 40);
    internals.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, shiftKey: true }));
    expect(internals.pan.y).toBe(0);
    internals.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 1e6, shiftKey: true }));
    expect(internals.pan.y).toBe(internals.pan.minY);
  });

  it("scrolls sideways with Shift and the wheel when only the width overflows", async () => {
    const { internals } = await setup(200, 2000, 40, 3);
    internals.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, shiftKey: true }));
    expect(internals.pan.x).toBe(-30);
    expect(internals.pan.y).toBe(0);
  });

  it("scrolls up and down with Shift and a sideways wheel when only the height overflows", async () => {
    const { internals } = await setup(2000, 200, 3, 40);
    internals.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 30, shiftKey: true }));
    expect(internals.pan.x).toBe(0);
    expect(internals.pan.y).toBe(-30);
  });

  it("leaves the plain wheel to the window, even on a large board", async () => {
    const { internals } = await setup(200, 200, 40, 40);
    const event = new WheelEvent("wheel", { deltaY: 30, cancelable: true });
    internals.app.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(internals.pan.y).toBe(0);
  });

  it("ignores the wheel when everything fits", async () => {
    const { internals } = await setup();
    const event = new WheelEvent("wheel", { deltaY: 30, shiftKey: true, cancelable: true });
    internals.app.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("drags a large board with the middle button", async () => {
    const { internals } = await setup(200, 200, 40, 40);
    const stage = internals.app.stage;
    stage.emit("pointerdown", fake.pointer(1, 4, { x: 100, y: 100 }));
    stage.emit("globalpointermove", fake.pointer(1, 4, { x: 60, y: 70 }));
    expect(internals.pan).toMatchObject({ x: -40, y: -30 });
    stage.emit("pointerup", fake.pointer(1));
    stage.emit("globalpointermove", fake.pointer(0, 0, { x: 0, y: 0 }));
    expect(internals.pan).toMatchObject({ x: -40, y: -30 });
  });

  it("rebuilds with a new theme", async () => {
    const { view, internals } = await setup();
    const before = [...internals.contexts.values()];
    view.setTheme(themeById("charcoal").board);
    expect(before.every((c) => c.destroyed)).toBe(true);
    expect(internals.contexts.size).toBeGreaterThan(0);
  });
});

describe("touch input", () => {
  it("opens on a tap and flags on a long press", async () => {
    vi.useFakeTimers();
    const { cell, handlers } = await setup();
    cell(4).root.emit("pointerdown", fake.touch(1));
    cell(4).root.emit("pointerup", fake.touch(1));
    expect(handlers.primary).toHaveBeenCalledWith(4);

    cell(5).root.emit("pointerdown", fake.touch(1));
    vi.advanceTimersByTime(500);
    expect(handlers.secondary).toHaveBeenCalledWith(5);
    cell(5).root.emit("pointerup", fake.touch(1));
    expect(handlers.primary).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancels the long press when the finger moves", async () => {
    vi.useFakeTimers();
    const { internals, cell, handlers } = await setup();
    const stage = internals.app.stage;
    cell(4).root.emit("pointerdown", fake.touch(1, { x: 10, y: 10 }));
    stage.emit("pointerdown", fake.touch(1, { x: 10, y: 10 }));
    stage.emit("globalpointermove", fake.touch(1, { x: 40, y: 10 }));
    vi.advanceTimersByTime(500);
    expect(handlers.secondary).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("forgets a touch the system cancels", async () => {
    vi.useFakeTimers();
    const { internals, cell, handlers } = await setup();
    const stage = internals.app.stage;
    cell(0).root.emit("pointerdown", fake.touch(1));
    stage.emit("pointerdown", fake.touch(1));
    internals.app.canvas.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1, pointerType: "touch" }),
    );
    vi.advanceTimersByTime(500);
    expect(handlers.secondary).not.toHaveBeenCalled();
    // A later tap is a tap, not the second finger of a pinch.
    cell(4).root.emit("pointerdown", fake.touch(2));
    stage.emit("pointerdown", fake.touch(2));
    cell(4).root.emit("pointerup", fake.touch(2));
    stage.emit("pointerup", fake.touch(2));
    expect(handlers.primary).toHaveBeenCalledWith(4);
    vi.useRealTimers();
  });

  it("forgets touches when the window loses focus", async () => {
    vi.useFakeTimers();
    const { internals, cell, handlers } = await setup();
    const stage = internals.app.stage;
    cell(0).root.emit("pointerdown", fake.touch(1));
    stage.emit("pointerdown", fake.touch(1));
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(500);
    expect(handlers.secondary).not.toHaveBeenCalled();
    cell(4).root.emit("pointerdown", fake.touch(2));
    stage.emit("pointerdown", fake.touch(2));
    cell(4).root.emit("pointerup", fake.touch(2));
    expect(handlers.primary).toHaveBeenCalledWith(4);
    vi.useRealTimers();
  });
});

describe("pointer input", () => {
  it("opens on release over the pressed cell", async () => {
    const { cell, handlers } = await setup();
    cell(4).root.emit("pointerdown", fake.pointer(0, 1));
    expect(cell(4).pressed).toBe(true);
    cell(4).root.emit("pointerup", fake.pointer(0));
    expect(handlers.primary).toHaveBeenCalledWith(4);
    expect(cell(4).pressed).toBe(false);
  });

  it("follows a drag with the button held and opens where it's released", async () => {
    const { cell, handlers } = await setup();
    cell(0).root.emit("pointerdown", fake.pointer(0, 1));
    cell(1).root.emit("pointerover", fake.pointer(0, 1));
    expect(cell(0).pressed).toBe(false);
    expect(cell(1).pressed).toBe(true);
    cell(1).root.emit("pointerup", fake.pointer(0));
    expect(handlers.primary).toHaveBeenCalledWith(1);
  });

  it("doesn't open when released over another cell", async () => {
    const { cell, handlers } = await setup();
    cell(0).root.emit("pointerdown", fake.pointer(0, 1));
    cell(2).root.emit("pointerup", fake.pointer(0));
    expect(handlers.primary).not.toHaveBeenCalled();
  });

  it("marks with the right button", async () => {
    const { cell, handlers } = await setup();
    cell(3).root.emit("pointerdown", fake.pointer(2));
    expect(handlers.secondary).toHaveBeenCalledWith(3);
  });

  it("previews the neighbors a smart click would touch", async () => {
    const { view, cell, settle } = await setup();
    view.apply([{ cell: 4, view: { kind: "open", adjacent: 2 }, wave: 0 }], "playing");
    settle();
    cell(4).root.emit("pointerdown", fake.pointer(0, 1));
    expect([0, 1, 2, 3, 5, 6, 7, 8].every((i) => cell(i).pressed)).toBe(true);
    // Releasing anywhere clears the preview.
    (view as unknown as Internals).app.stage.emit("pointerupoutside", fake.pointer(0));
    expect(cell(0).pressed).toBe(false);
  });

  it("doesn't press flagged cells", async () => {
    const { view, cell, settle } = await setup();
    view.apply([{ cell: 0, view: { kind: "closed", mark: "flag" }, wave: 0 }], "playing");
    settle();
    cell(0).root.emit("pointerdown", fake.pointer(0, 1));
    expect(cell(0).pressed).toBe(false);
  });

  it("ignores input while locked, and hides the cells", async () => {
    const { view, cell, handlers, internals, settle } = await setup();
    view.setLocked(true);
    settle();
    expect(internals.cellLayer.alpha).toBe(0);
    cell(0).root.emit("pointerdown", fake.pointer(2));
    cell(0).root.emit("pointerdown", fake.pointer(0, 1));
    cell(0).root.emit("pointerup", fake.pointer(0));
    expect(handlers.secondary).not.toHaveBeenCalled();
    expect(handlers.primary).not.toHaveBeenCalled();
    view.setLocked(false);
    settle();
    expect(internals.cellLayer.alpha).toBe(1);
  });

  it("highlights closed cells on hover", async () => {
    const { cell, internals } = await setup();
    const before = cell(0).shape.context;
    cell(0).root.emit("pointerover", fake.pointer());
    expect(cell(0).shape.context).not.toBe(before);
    cell(0).root.emit("pointerout", fake.pointer());
    expect(cell(0).shape.context).toBe(before);
    expect(internals.app.ticker.started).toBe(true);
  });
});

describe("animation", () => {
  it("reveals cells in waves and draws their numbers", async () => {
    const { view, cell, internals } = await setup();
    view.apply(
      [
        { cell: 0, view: { kind: "open", adjacent: 0 }, wave: 0 },
        { cell: 8, view: { kind: "open", adjacent: 3 }, wave: 5 },
      ],
      "playing",
    );
    internals.app.ticker.step(16);
    expect(cell(0).glyph.children).toHaveLength(0);
    expect(cell(8).glyph.children).toHaveLength(0);
    for (let i = 0; i < 20; i++) internals.app.ticker.step(16);
    const label = cell(8).glyph.children[0] as fake.Text;
    expect(label.text).toBe("3");
  });

  it("draws flags, question marks, mines and wrong flags", async () => {
    const { view, cell, settle } = await setup();
    view.apply(
      [
        { cell: 0, view: { kind: "closed", mark: "flag" }, wave: 0 },
        { cell: 1, view: { kind: "closed", mark: "question" }, wave: 0 },
        { cell: 2, view: { kind: "mine", exploded: false }, wave: 0 },
        { cell: 3, view: { kind: "wrongFlag" }, wave: 0 },
        { cell: 4, view: { kind: "mine", exploded: true }, wave: 0 },
      ],
      "lost",
    );
    settle();
    expect(cell(0).glyph.children).toHaveLength(1);
    expect((cell(1).glyph.children[0] as fake.Text).text).toBe("?");
    expect(cell(2).glyph.children).toHaveLength(1);
    expect(cell(3).glyph.children).toHaveLength(2);
    expect(cell(4).shape.context).not.toBe(cell(2).shape.context);
  });

  it("draws a theme's SVG glyphs once they load, and its own until then", async () => {
    // jsdom never loads images; this one loads as soon as it gets a source.
    vi.spyOn(window, "Image").mockImplementation(function () {
      const image = document.createElement("img");
      Object.defineProperty(image, "src", {
        set: () => queueMicrotask(() => image.onload?.(new Event("load"))),
      });
      return image;
    } as never);
    const svg = svgGlyph("<svg viewBox='0 0 1 1'/>");
    const { view, cell, settle } = await setup();
    view.setTheme({ ...theme, glyphs: { flag: svg, question: svg, mine: svg, "1": svg } });
    view.apply(
      [
        { cell: 0, view: { kind: "closed", mark: "flag" }, wave: 0 },
        { cell: 1, view: { kind: "closed", mark: "question" }, wave: 0 },
        { cell: 2, view: { kind: "mine", exploded: false }, wave: 0 },
        { cell: 3, view: { kind: "wrongFlag" }, wave: 0 },
        { cell: 4, view: { kind: "open", adjacent: 1 }, wave: 0 },
        { cell: 5, view: { kind: "open", adjacent: 2 }, wave: 0 },
      ],
      "lost",
    );
    settle();
    expect(cell(0).glyph.children[0]).toBeInstanceOf(fake.Graphics);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const i of [0, 1, 2, 4])
      expect(cell(i).glyph.children[0], `cell ${i}`).toBeInstanceOf(fake.Sprite);
    const [flag, cross] = cell(3).glyph.children;
    expect(flag).toBeInstanceOf(fake.Sprite);
    expect(flag?.alpha).toBe(0.45);
    expect(cross).toBeInstanceOf(fake.Graphics);
    expect(cell(5).glyph.children[0]).toBeInstanceOf(fake.Text);

    view.setTheme({ ...themeById("pride").board, glyphs: { "1": svg } });
    const [fill, number] = cell(4).glyph.children;
    expect(fill).toBeInstanceOf(fake.Graphics);
    expect(number).toBeInstanceOf(fake.Sprite);
    expect(cell(5).glyph.children).toHaveLength(1);
  });

  it("shakes the board and stops ticking once a loss settles", async () => {
    const { view, internals, settle } = await setup();
    view.apply([{ cell: 4, view: { kind: "mine", exploded: true }, wave: 0 }], "lost");
    expect(internals.shake.time).toBeGreaterThan(0);
    settle(400);
    expect(internals.shake.time).toBe(0);
    expect(internals.app.ticker.started).toBe(false);
  });

  it("celebrates a win, then goes idle", async () => {
    const { view, internals, settle } = await setup();
    view.apply([{ cell: 0, view: { kind: "open", adjacent: 0 }, wave: 0 }], "won");
    for (let i = 0; i < 20; i++) internals.app.ticker.step(16);
    expect(internals.overlayLayer.children.length).toBeGreaterThan(0);
    settle(500);
    expect(internals.app.ticker.started).toBe(false);
  });

  it("goes idle after the entrance and wakes on demand", async () => {
    const { view, internals, settle } = await setup();
    settle();
    expect(internals.app.ticker.started).toBe(false);
    view.setFocus(4);
    expect(internals.app.ticker.started).toBe(true);
  });

  it("shares count fills between cells in color themes", async () => {
    const { view, cell, internals, settle } = await setup();
    view.setTheme(themeById("pride").board);
    view.apply(
      [
        { cell: 0, view: { kind: "open", adjacent: 2 }, wave: 0 },
        { cell: 8, view: { kind: "open", adjacent: 2 }, wave: 0 },
      ],
      "playing",
    );
    settle();
    const fill = (i: number) => (cell(i).glyph.children[0] as fake.Graphics).context;
    expect(fill(0)).toBe(fill(8));
    const shared = fill(0);
    view.setTheme(themeById("spectrum").board);
    expect(shared.destroyed).toBe(true);
    expect(internals.contexts.size).toBeGreaterThan(0);
  });

  it("draws counts from the theme's ring start as rings", async () => {
    const { view, cell, settle } = await setup();
    view.setTheme(themeById("pride").board);
    view.apply(
      [
        { cell: 0, view: { kind: "open", adjacent: 8 }, wave: 0 },
        { cell: 1, view: { kind: "open", adjacent: 9 }, wave: 0 },
        { cell: 2, view: { kind: "open", adjacent: 1 }, wave: 0 },
      ],
      "playing",
    );
    settle();
    const calls = (i: number) => (cell(i).glyph.children[0] as fake.Graphics).context.calls;
    expect(calls(0)).not.toContain("cut");
    expect(calls(1)).toContain("cut");
    // 9 is a ring of 1's color, so the two share a color but not a drawing.
    expect(calls(2)).not.toContain("cut");
  });

  it("skips motion when the system asks for reduced motion", async () => {
    reducedMotion = true;
    const { view, internals, cell, settle } = await setup();
    expect(cell(0).root.alpha).toBe(1);
    view.apply([{ cell: 4, view: { kind: "mine", exploded: true }, wave: 3 }], "lost");
    expect(internals.shake.time).toBe(0);
    settle();
    expect(cell(4).glyph.children).toHaveLength(1);
  });
});

describe("the count readout", () => {
  const texts = (glyph: fake.Container) =>
    glyph.children.filter((c): c is fake.Text => c instanceof fake.Text).map((c) => c.text);

  async function colorBoard() {
    const board = await setup();
    board.view.setTheme(themeById("pride").board);
    board.view.apply(
      [
        { cell: 0, view: { kind: "open", adjacent: 3 }, wave: 0 },
        { cell: 1, view: { kind: "open", adjacent: 10 }, wave: 0 },
        { cell: 2, view: { kind: "open", adjacent: 0 }, wave: 0 },
      ],
      "playing",
    );
    board.settle();
    return board;
  }

  it("names the count under the pointer, then the one under the focus", async () => {
    const { view, cell, handlers } = await colorBoard();
    cell(0).root.emit("pointerover", fake.pointer(0, 0));
    expect(handlers.inspect).toHaveBeenLastCalledWith(3);
    view.setFocus(1);
    expect(handlers.inspect).toHaveBeenLastCalledWith(10);
    cell(2).root.emit("pointerover", fake.pointer(0, 0));
    expect(handlers.inspect).toHaveBeenLastCalledWith(null);
    cell(2).root.emit("pointerout", fake.pointer(0, 0));
    expect(handlers.inspect).toHaveBeenLastCalledWith(10);
  });

  it("shows the inspected count as a digit in a color theme", async () => {
    const { view, cell } = await colorBoard();
    expect(texts(cell(0).glyph)).toEqual([]);
    view.setFocus(0);
    expect(texts(cell(0).glyph)).toEqual(["3"]);
    view.setFocus(1);
    expect(texts(cell(0).glyph)).toEqual([]);
    expect(texts(cell(1).glyph)).toEqual(["10"]);
  });

  it("names the count of a cell that opens under the pointer", async () => {
    const { view, cell, handlers, settle } = await setup();
    cell(4).root.emit("pointerover", fake.pointer(0, 0));
    expect(handlers.inspect).toHaveBeenLastCalledWith(null);
    view.apply([{ cell: 4, view: { kind: "open", adjacent: 2 }, wave: 0 }], "playing");
    settle();
    expect(handlers.inspect).toHaveBeenLastCalledWith(2);
  });

  it("names nothing while the board is locked", async () => {
    const { view, handlers } = await colorBoard();
    view.setFocus(0);
    view.setLocked(true);
    expect(handlers.inspect).toHaveBeenLastCalledWith(null);
    view.setLocked(false);
    expect(handlers.inspect).toHaveBeenLastCalledWith(3);
  });

  it("starts a new board with nothing inspected", async () => {
    const { view, handlers } = await colorBoard();
    view.setFocus(0);
    view.load(snapshot());
    expect(handlers.inspect).toHaveBeenLastCalledWith(null);
  });
});

describe("hint and focus rings", () => {
  /** Frames until the ticker stops itself. */
  const framesToIdle = (internals: Internals) => {
    let frames = 0;
    while (frames < 1000 && internals.app.ticker.step(16)) frames++;
    return frames;
  };
  const hintRing = (internals: Internals) => internals.overlayLayer.children[0] as fake.Graphics;

  it("pulses a hint for about three seconds, then holds it without ticking", async () => {
    const { view, internals, settle } = await setup();
    settle();
    view.showHint(4, "open");
    expect(internals.overlayLayer.children).toHaveLength(1);
    const alphas = new Set<number>();
    for (let i = 0; i < 40; i++) {
      internals.app.ticker.step(16);
      alphas.add(hintRing(internals).alpha);
    }
    expect(alphas.size).toBeGreaterThan(10);
    const frames = 40 + framesToIdle(internals);
    expect(frames * 16).toBeGreaterThanOrEqual(3000);
    expect(frames * 16).toBeLessThan(3200);
    expect(hintRing(internals).alpha).toBe(1);
    expect(internals.overlayLayer.children).toHaveLength(1);
    view.clearHint();
    expect(hintRing(internals).destroyed).toBe(true);
  });

  it("shows a steady hint without ticking under reduced motion", async () => {
    reducedMotion = true;
    const { view, internals, settle } = await setup();
    settle();
    view.showHint(4, "open");
    expect(framesToIdle(internals)).toBeLessThan(5);
    expect(hintRing(internals).alpha).toBe(1);
  });

  it("keeps the pulse clock across a relayout", async () => {
    const { view, internals, settle } = await setup();
    settle();
    view.showHint(4, "open");
    for (let i = 0; i < 100; i++) internals.app.ticker.step(16);
    view.setTheme(theme);
    expect(framesToIdle(internals) * 16).toBeLessThan(1600);
  });

  it("keeps the hint across a relayout", async () => {
    const { view, internals } = await setup();
    view.showHint(2, "flag");
    view.setTheme(theme);
    expect(internals.overlayLayer.children).toHaveLength(1);
  });

  it("ignores hints and focus for unknown cells", async () => {
    const { view, internals } = await setup();
    view.showHint(99, "open");
    view.setFocus(99);
    expect(internals.overlayLayer.children).toHaveLength(0);
  });

  it("moves and removes the focus ring", async () => {
    const { view, internals } = await setup();
    view.setFocus(1);
    view.setFocus(2);
    expect(internals.overlayLayer.children.filter((c) => !c.destroyed)).toHaveLength(1);
    view.setFocus(null);
    expect(internals.overlayLayer.children.filter((c) => !c.destroyed)).toHaveLength(0);
  });

  it("keeps the focus ring across zoom and theme changes", async () => {
    const { view, internals } = await setup(400, 400, 6, 6);
    const rings = () => internals.overlayLayer.children.filter((c) => !c.destroyed);
    view.setFocus(14);
    view.setZoom("in");
    expect(internals.focus?.cell).toBe(14);
    expect(rings()).toHaveLength(1);
    view.setTheme(themeById("midnight").board);
    expect(internals.focus?.cell).toBe(14);
    expect(rings()).toHaveLength(1);
  });

  it("drops the focus ring with a new board", async () => {
    const { view, internals } = await setup();
    view.setFocus(4);
    view.load(snapshot());
    expect(internals.focus).toBeNull();
    expect(internals.overlayLayer.children.filter((c) => !c.destroyed)).toHaveLength(0);
  });
});

describe("effects never block clicks", () => {
  it("keeps the overlay and effect layers out of hit testing", async () => {
    const { internals } = await setup();
    expect(internals.overlayLayer.eventMode).toBe("none");
    expect(internals.fxLayer.eventMode).toBe("none");
  });

  it("drops an explosion cut short by a new board", async () => {
    const { view, internals } = await setup();
    view.apply([{ cell: 4, view: { kind: "mine", exploded: true }, wave: 0 }], "lost");
    internals.app.ticker.step(16);
    expect(internals.fxLayer.children.length).toBeGreaterThan(0);
    view.load(snapshot());
    expect(internals.fxLayer.children).toHaveLength(0);
  });
});

describe("pointer presses", () => {
  it("reports every press with the cell it went down on, or none", async () => {
    const { internals, handlers, cell } = await setup();
    const stage = internals.app.stage;
    const press = (button: number, target: unknown, id?: number) => {
      const event = fake.pointer(button, 1 << button, { x: 1, y: 1 }, target);
      if (id !== undefined) cell(id).root.emit("pointerdown", event);
      stage.emit("pointerdown", event);
    };
    press(0, cell(3).root, 3);
    press(2, cell(5).root, 5);
    press(0, stage);
    expect(handlers.pointerPress.mock.calls).toEqual([[3], [5], [null]]);
  });
});

describe("field right click", () => {
  it("reports right clicks off the cells", async () => {
    const { internals, handlers } = await setup();
    const stage = internals.app.stage;
    stage.emit("pointerdown", fake.pointer(2, 2, { x: 1, y: 1 }, stage));
    expect(handlers.fieldSecondary).toHaveBeenCalledOnce();
    // Right clicks on a cell reach the stage too, but belong to the cell.
    stage.emit("pointerdown", fake.pointer(2, 2, { x: 1, y: 1 }, internals.cells[0]?.root));
    expect(handlers.fieldSecondary).toHaveBeenCalledOnce();
  });

  it("reports any right click while locked", async () => {
    const { view, internals, handlers } = await setup();
    view.setLocked(true);
    internals.app.stage.emit(
      "pointerdown",
      fake.pointer(2, 2, { x: 1, y: 1 }, internals.cells[0]?.root),
    );
    expect(handlers.fieldSecondary).toHaveBeenCalledOnce();
  });
});

describe("zoom", () => {
  it("steps in and out, between the fitted size and the largest cells", async () => {
    const { view, internals } = await setup(400, 400, 6, 6);
    const overflow = () => internals.pan.minX;
    view.setZoom("out");
    expect(overflow()).toBe(0);
    view.setZoom("in");
    expect(overflow()).toBeLessThan(0);
    view.setZoom("max");
    const atMax = overflow();
    view.setZoom("in");
    expect(overflow()).toBe(atMax);
    view.setZoom("fit");
    expect(overflow()).toBe(0);
  });

  it("leaves Ctrl and the wheel to the window", async () => {
    const { internals } = await setup(400, 400, 6, 6);
    const event = new WheelEvent("wheel", {
      deltaY: -10,
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    internals.app.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(internals.pan.minX).toBe(0);
  });
});

describe("lifecycle", () => {
  it("destroys the app and its shared drawings", async () => {
    const { view, internals } = await setup();
    const contexts = [...internals.contexts.values()];
    view.destroy();
    expect(internals.app.destroyed).toBe(true);
    expect(contexts.every((c) => c.destroyed)).toBe(true);
  });

  it("removes its listeners and cancels a pending long press", async () => {
    vi.useFakeTimers();
    const { view, cell, handlers } = await setup();
    expect(listening()).toBeGreaterThan(0);
    cell(4).root.emit("pointerdown", fake.touch(1));
    view.destroy();
    vi.advanceTimersByTime(500);
    expect(handlers.secondary).not.toHaveBeenCalled();
    expect(listening()).toBe(0);
    vi.useRealTimers();
  });

  it("redraws at the new pixel density when the window moves to another display", async () => {
    const { internals, cell } = await setup();
    const before = cell(0);
    const onFirst = [...listeners("(resolution: 1dppx)")];
    expect(onFirst).toHaveLength(1);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    onFirst[0]?.();
    expect(internals.app.renderer.resolution).toBe(2);
    expect(cell(0)).not.toBe(before);
    // The watch moves to the new density, so moving back is seen too.
    expect(listeners("(resolution: 1dppx)").size).toBe(0);
    expect(listeners("(resolution: 2dppx)").size).toBe(1);
  });
});

describe("light on cells", () => {
  const glossy = {
    ...theme,
    lightAngle: 345,
    sheenAlpha: 0,
    shadeAlpha: 0.3,
    glossAlpha: 0.6,
    glossFade: 0.1,
    rimAlpha: 0.4,
    rimWidth: 1.5,
    glintAlpha: 0.35,
    numberShadowAlpha: 0.5,
  };
  const textured = (style: unknown) =>
    typeof style === "object" && style !== null && "texture" in style;

  it("draws a lit theme's closed cells from one texture, and every cell's drawing batched", async () => {
    const { internals } = await setup(400, 400, 3, 3, glossy);
    const [closed] = [...internals.contexts.values()];
    expect(closed?.batchMode).toBe("batch");
    // The shaded body, the edge, the rim light, and the glare.
    expect(closed?.calls.filter((c) => c === "fill" || c === "stroke")).toEqual([
      "fill",
      "stroke",
      "stroke",
      "fill",
    ]);
    expect(closed?.styles.filter(textured)).toHaveLength(3);
  });

  it("keeps a flat theme's plain fills", async () => {
    const { internals } = await setup();
    const [closed] = [...internals.contexts.values()];
    expect(closed?.styles.some(textured)).toBe(false);
  });

  it("frees the light texture with the drawings", async () => {
    const { view, internals } = await setup(400, 400, 3, 3, glossy);
    const light = (internals as unknown as { light: { texture: fake.Texture } }).light;
    view.setTheme(glossy);
    expect(light.texture.destroyed).toBe(true);
  });

  it("sweeps a glint once across a closed cell under the pointer", async () => {
    const { internals, cell, settle } = await setup(400, 400, 3, 3, glossy);
    settle();
    cell(0).root.emit("pointerover", fake.pointer());
    const band = internals.glint?.band;
    expect(band && internals.overlayLayer.children).toContain(band);
    internals.app.ticker.step(200);
    expect(band?.context.calls).toContain("poly");
    settle();
    expect(internals.glint).toBeNull();
    expect(band?.destroyed).toBe(true);
  });

  it("shows no glint with reduced motion, or for a theme without one", async () => {
    reducedMotion = true;
    const reduced = await setup(400, 400, 3, 3, glossy);
    reduced.cell(0).root.emit("pointerover", fake.pointer());
    expect(reduced.internals.glint).toBeNull();
    reducedMotion = false;
    const plain = await setup();
    plain.cell(0).root.emit("pointerover", fake.pointer());
    expect(plain.internals.glint).toBeNull();
  });

  it("outlines the question mark when the theme has an outline for it", async () => {
    const outlined = { ...theme, questionOutline: 0x101010 };
    const { view, cell, settle } = await setup(400, 400, 3, 3, outlined);
    view.apply([{ cell: 4, view: { kind: "closed", mark: "question" }, wave: 0 }], "playing");
    settle();
    const mark = cell(4).glyph.children[0] as fake.Text;
    expect(mark.style.stroke).toMatchObject({ color: 0x101010 });
  });

  it("shadows digits away from the light", async () => {
    const { view, cell, settle } = await setup(400, 400, 3, 3, glossy);
    view.apply([{ cell: 4, view: { kind: "open", adjacent: 2 }, wave: 0 }], "playing");
    settle();
    const digit = cell(4).glyph.children[0] as fake.Text;
    expect(digit.style.dropShadow).toMatchObject({ alpha: glossy.numberShadowAlpha });
    const { angle } = digit.style.dropShadow as { angle: number };
    // The light comes from left of the top, so the shadow falls right of down.
    expect(angle).toBeGreaterThan(Math.PI / 4);
    expect(angle).toBeLessThan(Math.PI / 2);
  });
});

describe("the ferrofluid effect", () => {
  const ferrofluid = themeById("ferrofluid").board;
  interface Fluid {
    ferro: {
      surface: fake.Mesh;
      aim: { x: number; y: number } | null;
      surge: number;
      playing: boolean;
    } | null;
    glyphLayer: fake.Container;
  }
  const fluidOf = (internals: Internals) => internals as unknown as Internals & Fluid;

  it("lays the fluid over the open cells' plates, under the glyphs", async () => {
    const { view, internals, cell } = await setup(400, 400, 3, 3, ferrofluid);
    const { ferro, glyphLayer } = fluidOf(internals);
    expect(internals.viewport.children.slice(0, 3)).toEqual([
      internals.cellLayer,
      ferro?.surface,
      glyphLayer,
    ]);
    expect(glyphLayer.children).toHaveLength(9);
    expect(cell(0).root.children).not.toContain(cell(0).glyph);
    expect(cell(0).shape.visible).toBe(false);
    view.apply([{ cell: 4, view: { kind: "open", adjacent: 2 }, wave: 0 }], "playing");
    internals.app.ticker.step(16);
    expect(cell(4).shape.visible).toBe(true);
  });

  it("raises a spike for a flag instead of drawing one", async () => {
    const { view, internals, cell, settle } = await setup(400, 400, 3, 3, ferrofluid);
    view.apply([{ cell: 0, view: { kind: "closed", mark: "flag" }, wave: 0 }], "playing");
    settle();
    expect(cell(0).glyph.children).toHaveLength(0);
    expect(internals.app.renderer.renders.length).toBeGreaterThan(0);
  });

  it("lights digits from beneath in their own color, with room for the glow", async () => {
    const { view, cell, settle } = await setup(400, 400, 3, 3, ferrofluid);
    view.apply([{ cell: 4, view: { kind: "open", adjacent: 2 }, wave: 0 }], "playing");
    settle();
    const digit = cell(4).glyph.children[0] as fake.Text;
    expect(digit.style.dropShadow).toMatchObject({ distance: 0, color: ferrofluid.numbers[1] });
    expect(digit.style.padding).toBeGreaterThan(0);
  });

  it("aims the magnet at the pointer, then at the keyboard focus once it leaves", async () => {
    const { view, internals } = await setup(400, 400, 3, 3, ferrofluid);
    const fluid = fluidOf(internals);
    internals.app.stage.emit("globalpointermove", fake.pointer(0, 0, { x: 120, y: 90 }));
    expect(fluid.ferro?.aim).toEqual({ x: 120, y: 90 });
    view.setFocus(4);
    internals.app.canvas.dispatchEvent(new Event("pointerleave"));
    const anchor = view.anchorOf(4);
    expect(fluid.ferro?.aim).toEqual({ x: anchor?.x, y: anchor?.y });
    view.setFocus(null);
    expect(fluid.ferro?.aim).toBeNull();
  });

  it("drops the magnet while the board is paused", async () => {
    const { view, internals, settle } = await setup(400, 400, 3, 3, ferrofluid);
    const fluid = fluidOf(internals);
    internals.app.stage.emit("globalpointermove", fake.pointer(0, 0, { x: 120, y: 90 }));
    view.setLocked(true);
    settle();
    expect(fluid.ferro?.aim).toBeNull();
    expect(fluid.ferro?.surface.alpha).toBe(0);
  });

  it("keeps the surface on the host while the board pans", async () => {
    const { internals } = await setup(200, 200, 40, 40, ferrofluid);
    internals.app.canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 50, shiftKey: true, cancelable: true }),
    );
    internals.app.ticker.step(16);
    const surface = fluidOf(internals).ferro?.surface;
    expect(surface?.position.y).toBe(-internals.viewport.y);
  });

  it("splashes on a win instead of the glow and the confetti, and swells digits the ring passes", async () => {
    const { view, internals, cell } = await setup(400, 400, 3, 3, ferrofluid);
    view.apply([{ cell: 1, view: { kind: "open", adjacent: 1 }, wave: 0 }], "won");
    let swelled = 0;
    for (let i = 0; i < 120; i++) {
      internals.app.ticker.step(16);
      swelled = Math.max(swelled, cell(1).glyphRoot?.scale.x ?? 0);
    }
    expect(swelled).toBeGreaterThan(1.05);
    expect(internals.overlayLayer.children).toHaveLength(0);
    expect(internals.fxLayer.children).toHaveLength(0);
    for (let i = 0; i < 400; i++) internals.app.ticker.step(16);
    expect(fluidOf(internals).ferro?.playing).toBe(false);
    expect(cell(1).glyphRoot?.scale.x).toBe(1);
  });

  it("throws the spikes up on a loss", async () => {
    const { view, internals } = await setup(400, 400, 3, 3, ferrofluid);
    view.apply([{ cell: 4, view: { kind: "mine", exploded: true }, wave: 0 }], "lost");
    for (let i = 0; i < 8; i++) internals.app.ticker.step(16);
    expect(fluidOf(internals).ferro?.surge).toBeGreaterThan(0);
  });

  it("goes away with a theme that doesn't ask for it", async () => {
    const { view, internals, cell } = await setup(400, 400, 3, 3, ferrofluid);
    const surface = fluidOf(internals).ferro?.surface;
    view.setTheme(theme);
    expect(fluidOf(internals).ferro).toBeNull();
    expect(surface?.destroyed).toBe(true);
    expect(cell(0).shape.visible).toBe(true);
  });
});
