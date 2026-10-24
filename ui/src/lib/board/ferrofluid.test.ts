import { describe, expect, it, vi } from "vitest";
import * as fake from "../../test/fakePixi";
import { themeById } from "../themes/catalog";
import type { FluidCell, FluidState } from "./ferrofluid";

vi.mock("pixi.js", () => fake);

const { Ferrofluid } = await import("./ferrofluid");

const theme = themeById("ferrofluid").board;
const SQUARE = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

function cells(states: FluidState[]): FluidCell[] {
  return states.map((state, i) => ({
    center: { x: 20 + i * 22, y: 20 },
    outline: SQUARE,
    inradius: 10,
    state,
  }));
}

function setup(states: FluidState[] = ["full", "full", "drained"]) {
  const renderer = { render: vi.fn() };
  const fluid = new Ferrofluid(renderer as never, theme);
  fluid.layout(cells(states), 200, 100);
  const uniforms = (fluid.surface.shader?.resources as { ferrofluid: { uniforms: Uniforms } })
    .ferrofluid.uniforms;
  /** The field container the first render drew: the cells' blobs, then the flags' seeds. */
  const field = () => renderer.render.mock.calls[0]?.[0].container as fake.Container;
  const blob = (id: number) => field().children[0]?.children[id] as fake.Graphics;
  const seeds = () => field().children[1]?.children as fake.Graphics[];
  /** Each cell's spike seed, in the blue channel. */
  const core = (id: number) => field().children[2]?.children[id] as fake.Graphics;
  const pan = { x: 0, y: 0 };
  /** Runs frames until nothing moves or the limit is hit; returns how many ran. */
  const settle = (motion = true, frames = 600) => {
    let n = 0;
    while (n < frames && fluid.tick(16, pan, motion)) n++;
    return n;
  };
  return { fluid, renderer, uniforms, field, blob, seeds, core, pan, settle };
}

interface Uniforms {
  uSize: Float32Array;
  uMagnet: Float32Array;
  uRings: Float32Array;
  uDrop: Float32Array;
  uCrown: Float32Array;
  uCenter: Float32Array;
  uFluid: Float32Array;
  uPull: number;
  uSurge: number;
  uSpacing: number;
  uSeedPeak: number;
  uHasFlags: number;
}

describe("Ferrofluid", () => {
  it("draws full cells red and leaves drained ones out of the field", () => {
    const { fluid, blob, pan } = setup();
    fluid.tick(16, pan, true);
    expect(blob(0).tint).toBe(0xff0000);
    expect(blob(0).visible).toBe(true);
    expect(blob(2).visible).toBe(false);
  });

  it("seeds a spike at every full cell's center, which a flag or a drain takes away", () => {
    const { fluid, core, settle, pan } = setup();
    fluid.tick(16, pan, true);
    expect(core(0).tint).toBe(0x0000ff);
    expect(core(0).blendMode).toBe("add");
    expect(core(2).visible).toBe(false);
    fluid.setState(0, "flagged", true);
    settle();
    expect(core(0).visible).toBe(false);
    fluid.follow(1, 0.5, 0.5);
    expect(core(1).scale.x).toBeCloseTo(10 * 0.3 * 0.5);
  });

  it("draws the field once, then again only after a change", () => {
    const { fluid, renderer, pan } = setup();
    fluid.tick(16, pan, true);
    // The field, then the blur across and the blur down.
    expect(renderer.render).toHaveBeenCalledTimes(3);
    fluid.tick(16, pan, true);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    fluid.tick(16, { x: 5, y: 0 }, true);
    expect(renderer.render).toHaveBeenCalledTimes(6);
  });

  it("sizes the surface and the lattice to the host and the cells", () => {
    const { fluid, uniforms } = setup();
    expect(fluid.surface.scale.x).toBe(200);
    expect([...uniforms.uSize]).toEqual([200, 100]);
    expect(uniforms.uSpacing).toBeCloseTo(9.5);
    expect(uniforms.uSeedPeak).toBeGreaterThan(0);
    expect(uniforms.uSeedPeak).toBeLessThan(1);
  });

  it("takes the fluid's colors from the theme", () => {
    const { uniforms } = setup();
    const closed = theme.closed;
    expect(uniforms.uFluid[0]).toBeCloseTo(((closed >> 16) & 255) / 255);
  });

  it("drains an opened cell over a few frames", () => {
    const { fluid, blob, settle, pan } = setup();
    fluid.tick(16, pan, true);
    fluid.setState(0, "drained", true);
    fluid.tick(16, pan, true);
    const midway = blob(0).tint >> 16;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(255);
    expect(settle()).toBeLessThan(100);
    expect(blob(0).visible).toBe(false);
  });

  it("drains at once when motion is reduced", () => {
    const { fluid, blob, pan } = setup();
    fluid.setState(1, "pressed", false);
    fluid.tick(16, pan, false);
    expect(blob(1).tint >> 16).toBe(Math.round(0.4 * 255));
  });

  it("raises a flag's seed in the green channel and says the board has flags", () => {
    const { fluid, seeds, uniforms, settle } = setup();
    fluid.setState(0, "flagged", true);
    settle();
    expect(seeds()).toHaveLength(1);
    expect(seeds()[0]?.tint).toBe(0x00ff00);
    expect(seeds()[0]?.blendMode).toBe("add");
    expect(uniforms.uHasFlags).toBe(1);
    fluid.setState(0, "full", true);
    settle();
    expect(seeds()[0]?.visible).toBe(false);
    expect(uniforms.uHasFlags).toBe(0);
  });

  it("follows a cell's scale and opacity during the entrance", () => {
    const { fluid, renderer, blob, pan } = setup();
    fluid.tick(16, pan, true);
    fluid.follow(0, 0.5, 0.25);
    fluid.tick(16, pan, true);
    expect(blob(0).scale.x).toBe(0.5);
    expect(blob(0).alpha).toBe(0.25);
    expect(renderer.render).toHaveBeenCalledTimes(6);
    fluid.follow(0, 0.5, 0.25);
    fluid.tick(16, pan, true);
    expect(renderer.render).toHaveBeenCalledTimes(6);
  });

  it("springs the magnet to the pointer and lets go when it leaves", () => {
    const { fluid, uniforms, settle } = setup();
    fluid.point({ x: 30, y: 20 });
    fluid.point({ x: 60, y: 20 });
    expect(settle()).toBeGreaterThan(5);
    expect(uniforms.uPull).toBe(1);
    expect(uniforms.uMagnet[0]).toBeCloseTo(60, 0);
    fluid.point(null);
    settle();
    expect(uniforms.uPull).toBe(0);
  });

  it("lands the first magnet where it points, not on its way there", () => {
    const { fluid, uniforms, pan } = setup();
    fluid.point({ x: 150, y: 50 });
    fluid.tick(16, pan, true);
    expect(uniforms.uMagnet[0]).toBeCloseTo(150);
  });

  it("jumps the magnet and its pull when motion is reduced", () => {
    const { fluid, uniforms, pan } = setup();
    fluid.point({ x: 40, y: 20 });
    expect(fluid.tick(16, pan, false)).toBe(false);
    expect(uniforms.uPull).toBe(1);
  });

  it("throws every spike up on a loss, then lets them slump", () => {
    const { fluid, uniforms, pan, settle } = setup();
    fluid.burst({ x: 20, y: 20 });
    for (let i = 0; i < 10; i++) fluid.tick(16, pan, true);
    expect(uniforms.uSurge).toBeGreaterThan(0.3);
    expect(uniforms.uRings[0]).toBeGreaterThan(0);
    expect(fluid.playing).toBe(true);
    settle();
    expect(uniforms.uSurge).toBe(0);
    expect(uniforms.uRings[0]).toBe(-1);
    expect(fluid.playing).toBe(false);
  });

  it("drops a droplet on a win, then floods the cells as its ring passes and drains them", () => {
    const { fluid, uniforms, pan, blob, settle } = setup(["full", "drained", "drained"]);
    fluid.tick(16, pan, true);
    fluid.splash({ x: 20, y: 20 });
    fluid.tick(100, pan, true);
    expect(uniforms.uDrop[1]).toBeGreaterThan(0);
    expect([...uniforms.uCenter]).toEqual([20, 20]);
    // Past the fall, the crown is up and the ring has crossed the drained cells.
    for (let i = 0; i < 60; i++) fluid.tick(16, pan, true);
    expect(uniforms.uDrop[1]).toBe(0);
    expect(uniforms.uRings[0]).toBeGreaterThan(0);
    expect(blob(2).tint >> 16).toBeGreaterThan(0);
    settle();
    expect(fluid.playing).toBe(false);
    expect(blob(2).visible).toBe(false);
    expect(blob(0).tint).toBe(0xff0000);
  });

  it("crests under the points its ring or a reflection is passing", () => {
    const { fluid, pan } = setup();
    expect(fluid.crest({ x: 20, y: 20 })).toBe(0);
    fluid.splash({ x: 20, y: 20 });
    // 0.52 s of fall, then 0.1 s of ring at 8.5 inradii a second: about 8.5 px out.
    for (let i = 0; i < 39; i++) fluid.tick(16, pan, true);
    expect(fluid.crest({ x: 28.5, y: 20 })).toBeGreaterThan(0.5);
    expect(fluid.crest({ x: 150, y: 20 })).toBeLessThan(0.01);
  });

  it("ends a win at once when motion is reduced", () => {
    const { fluid, uniforms, pan } = setup();
    fluid.splash({ x: 100, y: 50 });
    expect(fluid.tick(16, pan, false)).toBe(false);
    expect(fluid.playing).toBe(false);
    expect(uniforms.uRings[0]).toBe(-1);
  });

  it("ignores cells it doesn't have", () => {
    const { fluid } = setup();
    expect(() => fluid.setState(99, "drained", true)).not.toThrow();
    expect(() => fluid.follow(99, 1, 1)).not.toThrow();
  });

  it("frees its shaders and targets", () => {
    const { fluid } = setup();
    fluid.destroy();
    expect(fluid.surface.destroyed).toBe(true);
    expect((fluid.surface.shader as unknown as fake.Shader).destroyed).toBe(true);
  });
});
