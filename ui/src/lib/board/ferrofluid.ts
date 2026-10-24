import {
  Container,
  Graphics,
  GraphicsContext,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  type Renderer,
} from "pixi.js";
import type { Point } from "../bindings";
import type { BoardTheme } from "../themes/types";
import { insetConvex, toward } from "./geometry";
import { BLUR_FRAGMENT, FERROFLUID_FRAGMENT, FERROFLUID_VERTEX } from "./ferrofluid.glsl";
import { lossAt, mirrors, wave, winAt, type Waves } from "./splash";

/** What the fluid does on a cell. */
export type FluidState = "full" | "pressed" | "flagged" | "drained";

/** A cell as the fluid sees it, in board-local CSS pixels. */
export interface FluidCell {
  center: Point;
  /** The cell's outline around its center, already inset by half the gap. */
  outline: Point[];
  inradius: number;
  state: FluidState;
}

/** Fluid level a pressed cell sinks to, from 0 for drained to 1 for full. */
const PRESSED_LEVEL = 0.4;
/** The film a win's ring leaves on every cell it crosses, drained or not. */
const FILM_LEVEL = 0.34;
/** Fluid pulls in from each outline by this share of the inradius, so cells part in valleys. */
const FIELD_INSET = 0.16;
/** The field blur's Gaussian sigma, as a share of the inradius. It turns flat cells into domes. */
const FIELD_BLUR = 0.34;
/** The seed of a cell's spike or a flag's, as a share of the inradius. */
const SEED = 0.3;
/**
 * Heights in inradii: the rounded edge where calm fluid meets a drained cell,
 * a cell's spike right under the magnet, and a flag's spike.
 */
const HEIGHT = { edge: 0.6, spike: 4.2, flag: 2.6 };
/** The shading camera's distance from the board, as a share of the host's larger side. */
const FOCAL = 1.4;
/**
 * The blur's sigma in field texels. The field takes whatever resolution gives
 * this sigma, since the blur smooths away anything finer. The taps sit one
 * texel apart and reach three sigmas; wider taps leave ripples on the domes.
 */
const SIGMA_TEXELS = 6;
/** The crown's spacing and the magnet's reach, in inradii. */
const LATTICE = 0.95;
const REACH = 2.6;
/** Time constants in seconds for fluid draining from or filling a cell. */
const DRAIN_S = 0.16;
const FILL_S = 0.12;
/**
 * Springs for the magnet's position and its pull: stiffness and damping per
 * second. Both are underdamped, so spikes overshoot and wobble as they settle.
 */
const FOLLOW = { stiffness: 140, damping: 15 };
const PULL = { stiffness: 70, damping: 7.5 };
/** A loss throws the spikes up this hard, in pull per second. */
const BURST_KICK = 9;
/** The surge a loss gives every spike on the board, which slumps back with a wobble. */
const SURGE = { stiffness: 20, damping: 2.6 };

/**
 * The ferrofluid board effect. Closed cells are drawn once into a blurred
 * field texture; a fragment shader reads it as a height field, adds spikes
 * that rise toward the magnet (the pointer or the keyboard focus), and lights
 * the result as a black, glossy liquid. Open cells keep the theme's drawing,
 * so the fluid looks drained from them.
 */
export class Ferrofluid {
  /** The lit surface, sized to the board's host. Add it under the cells. */
  readonly surface: Mesh<MeshGeometry, Shader>;
  private readonly field = new Container();
  private readonly blobs = new Container();
  private readonly seeds = new Container();
  /** A seed at each cell's center in the blue channel, where its spike rises under the magnet. */
  private readonly cores = new Container();
  /** The drawn field, blurred across into `across`, then down back into `target`. */
  private readonly target: RenderTexture;
  private readonly across: RenderTexture;
  private readonly blurAcross: Mesh<MeshGeometry, Shader>;
  private readonly blurDown: Mesh<MeshGeometry, Shader>;
  private readonly shader: Shader;
  private readonly uniforms: Record<string, unknown>;
  private readonly contexts = new Map<string, GraphicsContext>();
  private readonly seedContext = new GraphicsContext().circle(0, 0, 1).fill(0xffffff);

  private cells: FluidCell[] = [];
  private blobFor: Graphics[] = [];
  private coreFor: Graphics[] = [];
  private seedFor = new Map<number, Graphics>();
  private level = new Float32Array(0);
  private goal = new Float32Array(0);
  private flag = new Float32Array(0);
  private flagGoal = new Float32Array(0);
  /** Cells with any flag spike, risen or rising. */
  private flagged = new Set<number>();
  /** Cells whose level or flag is still on its way to the goal. */
  private moving = new Set<number>();
  private size = { width: 1, height: 1 };
  private inradius = 10;
  private pan = { x: NaN, y: NaN };
  private dirty = true;

  private magnet = { x: 0, y: 0, vx: 0, vy: 0 };
  private aim: Point | null = null;
  private pull = 0;
  private pullVelocity = 0;
  /** The game's end playing out, with its point in board-local pixels. */
  private event: { kind: "win" | "loss"; x: number; y: number; age: number } | null = null;
  private waves: Waves | null = null;
  /** The film each cell holds from a win's ring, over what its state gives it. */
  private flood = new Float32Array(0);
  /** Cells nearest the win's point first, and how far the flood and the drain have reached. */
  private floodOrder: { id: number; distance: number }[] = [];
  private flooded = 0;
  private drained = 0;
  /** The cells' extent in board-local pixels, which the win's ring reflects off. */
  private bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private surge = 0;
  private surgeVelocity = 0;
  private clock = 0;

  constructor(
    private readonly renderer: Renderer,
    theme: BoardTheme,
  ) {
    this.field.addChild(this.blobs, this.seeds, this.cores);
    const texture = () =>
      RenderTexture.create({
        width: 1,
        height: 1,
        resolution: 0.5,
        // Half floats keep the heights free of the steps 8 bits would leave.
        format: "rgba16float",
      });
    this.target = texture();
    this.across = texture();
    this.blurAcross = blurPass(this.target);
    this.blurDown = blurPass(this.across);
    this.uniforms = {
      uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
      uPan: { value: new Float32Array(2), type: "vec2<f32>" },
      uMagnet: { value: new Float32Array(2), type: "vec2<f32>" },
      uMagnetVelocity: { value: new Float32Array(2), type: "vec2<f32>" },
      uFocal: { value: 1000, type: "f32" },
      uPixel: { value: 1, type: "f32" },
      uPull: { value: 0, type: "f32" },
      uSpacing: { value: 10, type: "f32" },
      uReach: { value: 30, type: "f32" },
      uDome: { value: 5, type: "f32" },
      uSpike: { value: 15, type: "f32" },
      uFlagHeight: { value: 20, type: "f32" },
      uSeedPeak: { value: 1, type: "f32" },
      uHasFlags: { value: 0, type: "f32" },
      uCenter: { value: new Float32Array(2), type: "vec2<f32>" },
      uRings: { value: new Float32Array([-1, -1, -1, -1]), type: "vec4<f32>" },
      uRingHeights: { value: new Float32Array(4), type: "vec4<f32>" },
      uWavelength: { value: 10, type: "f32" },
      uReflect: { value: 0, type: "f32" },
      uBounds: { value: new Float32Array(4), type: "vec4<f32>" },
      uCrater: { value: new Float32Array([0, 1]), type: "vec2<f32>" },
      uCrown: { value: new Float32Array(2), type: "vec2<f32>" },
      uJet: { value: new Float32Array([0, 1]), type: "vec2<f32>" },
      uDrop: { value: new Float32Array(2), type: "vec2<f32>" },
      uSurge: { value: 0, type: "f32" },
      uLight: { value: new Float32Array(3), type: "vec3<f32>" },
      uFluid: { value: new Float32Array(3), type: "vec3<f32>" },
      uGloss: { value: new Float32Array(3), type: "vec3<f32>" },
      uRim: { value: new Float32Array(3), type: "vec3<f32>" },
      uTip: { value: new Float32Array(3), type: "vec3<f32>" },
    };
    this.shader = Shader.from({
      gl: { vertex: FERROFLUID_VERTEX, fragment: FERROFLUID_FRAGMENT, name: "ferrofluid" },
      resources: { uField: this.target.source, ferrofluid: this.uniforms },
    });
    this.surface = new Mesh({ geometry: unitQuad(), shader: this.shader });
    this.surface.eventMode = "none";
    this.setTheme(theme);
  }

  private get values() {
    const group = (this.shader.resources as Record<string, { uniforms: Record<string, unknown> }>)
      .ferrofluid;
    return group?.uniforms as Record<string, Float32Array | number>;
  }

  setTheme(theme: BoardTheme): void {
    const u = this.values;
    const rgb = (name: string, color: number) => {
      const out = u[name] as Float32Array;
      out[0] = ((color >> 16) & 255) / 255;
      out[1] = ((color >> 8) & 255) / 255;
      out[2] = (color & 255) / 255;
    };
    rgb("uFluid", theme.closed);
    rgb("uGloss", theme.gloss);
    rgb("uRim", theme.rim);
    rgb("uTip", theme.flag);
    const light = toward(theme.lightAngle);
    const l = u.uLight as Float32Array;
    l[0] = light.x * 0.75;
    l[1] = light.y * 0.75;
    l[2] = 1;
  }

  /** Lays the fluid out over new cells, in the host's size in CSS pixels. */
  layout(cells: FluidCell[], width: number, height: number): void {
    for (const blob of this.blobs.removeChildren()) blob.destroy();
    for (const seed of this.seeds.removeChildren()) seed.destroy();
    for (const core of this.cores.removeChildren()) core.destroy();
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
    this.seedFor.clear();
    this.flagged.clear();
    this.moving.clear();
    this.cells = cells;
    this.inradius = Math.min(...cells.slice(0, 16).map((c) => c.inradius)) || 10;
    const n = cells.length;
    this.level = new Float32Array(n);
    this.goal = new Float32Array(n);
    this.flag = new Float32Array(n);
    this.flagGoal = new Float32Array(n);
    this.flood = new Float32Array(n);
    this.event = null;
    this.waves = null;
    this.blobFor = [];
    this.coreFor = [];
    cells.forEach((cell, id) => {
      const blob = new Graphics(this.blobContext(cell));
      blob.position.copyFrom(cell.center);
      this.blobs.addChild(blob);
      this.blobFor.push(blob);
      const core = new Graphics({ context: this.seedContext, blendMode: "add" });
      core.position.copyFrom(cell.center);
      core.scale.set(cell.inradius * SEED);
      this.cores.addChild(core);
      this.coreFor.push(core);
      this.goal[id] = levelOf(cell.state);
      this.level[id] = this.goal[id] as number;
      this.flagGoal[id] = cell.state === "flagged" ? 1 : 0;
      this.flag[id] = this.flagGoal[id] as number;
      this.paint(id);
    });
    const xs = cells.map((c) => c.center.x);
    const ys = cells.map((c) => c.center.y);
    const edge = this.inradius;
    this.bounds = {
      minX: Math.min(...xs) - edge,
      minY: Math.min(...ys) - edge,
      maxX: Math.max(...xs) + edge,
      maxY: Math.max(...ys) + edge,
    };

    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    const sigma = Math.max(1, this.inradius * FIELD_BLUR);
    const resolution = Math.min(1, SIGMA_TEXELS / sigma);
    this.target.resize(this.size.width, this.size.height, resolution);
    this.across.resize(this.size.width, this.size.height, resolution);
    this.surface.scale.set(this.size.width, this.size.height);
    for (const [pass, source, dx, dy] of [
      [this.blurAcross, this.target, 1, 0],
      [this.blurDown, this.across, 0, 1],
    ] as const) {
      pass.scale.set(this.size.width, this.size.height);
      const blur = ((pass.shader as Shader).resources as BlurResources).blur.uniforms;
      // Small cells keep the field at full resolution, where their sigma spans fewer texels.
      const step = (sigma * resolution) / SIGMA_TEXELS;
      blur.uStep.set([
        (dx * step) / source.source.pixelWidth,
        (dy * step) / source.source.pixelHeight,
      ]);
    }
    const u = this.values;
    (u.uSize as Float32Array).set([this.size.width, this.size.height]);
    u.uSpacing = this.inradius * LATTICE;
    u.uReach = this.inradius * REACH;
    u.uDome = this.inradius * HEIGHT.edge;
    u.uFocal = FOCAL * Math.max(this.size.width, this.size.height);
    u.uPixel = 1 / (this.renderer.resolution || 1);
    u.uSpike = this.inradius * HEIGHT.spike;
    u.uFlagHeight = this.inradius * HEIGHT.flag;
    // A Gaussian blur of a disk of radius r peaks at 1 - exp(-r² / 2σ²).
    u.uSeedPeak = 1 - Math.exp(-(SEED * SEED) / (2 * FIELD_BLUR * FIELD_BLUR));
    this.dirty = true;
  }

  private blobContext(cell: FluidCell): GraphicsContext {
    const key = cell.outline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";");
    let context = this.contexts.get(key);
    if (!context) {
      const outline = insetConvex(cell.outline, cell.inradius * FIELD_INSET);
      context = new GraphicsContext().poly(outline.flatMap((p) => [p.x, p.y])).fill(0xffffff);
      this.contexts.set(key, context);
    }
    return context;
  }

  /** Changes what the fluid does on a cell; it drains or fills over a moment. */
  setState(id: number, state: FluidState, motion: boolean): void {
    const cell = this.cells[id];
    if (!cell) return;
    cell.state = state;
    this.goal[id] = Math.max(levelOf(state), this.flood[id] as number);
    this.flagGoal[id] = state === "flagged" ? 1 : 0;
    if (motion) {
      this.moving.add(id);
    } else {
      this.level[id] = this.goal[id] as number;
      this.flag[id] = this.flagGoal[id] as number;
      this.paint(id);
    }
    this.dirty = true;
  }

  /** Copies a cell's scale and opacity, for the board's entrance and its reveals. */
  follow(id: number, scale: number, alpha: number): void {
    const blob = this.blobFor[id];
    if (!blob || (blob.scale.x === scale && blob.alpha === alpha)) return;
    blob.scale.set(scale);
    blob.alpha = alpha;
    const seed = this.seedFor.get(id);
    if (seed) seed.alpha = alpha;
    const core = this.coreFor[id];
    if (core) {
      core.scale.set((this.cells[id] as FluidCell).inradius * SEED * scale);
      core.alpha = alpha;
    }
    this.dirty = true;
  }

  /** Moves the magnet toward a point in the host, in CSS pixels, or takes it away. */
  point(at: Point | null): void {
    if (at && !this.aim && this.pull < 0.05) {
      // A magnet that arrives raises spikes where it lands, not on the way there.
      this.magnet = { x: at.x, y: at.y, vx: 0, vy: 0 };
    }
    this.aim = at;
  }

  /**
   * A loss at a point in the host: every spike on the board jumps and slumps
   * back with a wobble, and quick ripples leave the mine.
   */
  burst(at: Point): void {
    this.magnet = { x: at.x, y: at.y, vx: 0, vy: 0 };
    this.pullVelocity += BURST_KICK;
    this.surgeVelocity += BURST_KICK;
    this.aim = null;
    this.start("loss", at);
  }

  /** A win at a point in the host: a droplet lands there and floods the board for a moment. */
  splash(at: Point): void {
    this.start("win", at);
    const x = at.x - this.pan.x;
    const y = at.y - this.pan.y;
    this.floodOrder = this.cells
      .map((cell, id) => ({ id, distance: Math.hypot(cell.center.x - x, cell.center.y - y) }))
      .sort((a, b) => a.distance - b.distance);
    this.flooded = 0;
    this.drained = 0;
  }

  private start(kind: "win" | "loss", at: Point): void {
    const pan = Number.isNaN(this.pan.x) ? { x: 0, y: 0 } : this.pan;
    this.event = { kind, x: at.x - pan.x, y: at.y - pan.y, age: 0 };
  }

  /** Whether a win or a loss is still playing out. */
  get playing(): boolean {
    return this.event !== null;
  }

  /**
   * How near a win's ring, or one of its reflections, is to cresting at a
   * point in the host: 1 on the crest, falling to 0 a wavelength away.
   */
  crest(at: Point): number {
    const w = this.waves;
    const event = this.event;
    if (!w || !event || event.kind !== "win" || w.rings[0] < 0) return 0;
    const p = { x: at.x - this.pan.x, y: at.y - this.pan.y };
    const center = { x: event.x, y: event.y };
    const fade = w.heights[0] / (this.inradius * 0.6);
    let best = 0;
    const sources = [
      { point: center, k: 1 },
      ...mirrors(center, this.bounds).map((point) => ({ point, k: w.reflect })),
    ];
    for (const { point, k } of sources) {
      const d = Math.hypot(p.x - point.x, p.y - point.y) - w.rings[0];
      best = Math.max(best, k * Math.max(0, wave(d, w.wavelength)));
    }
    return Math.min(1, best * fade);
  }

  /**
   * Steps the springs and the levels, and draws the field again if anything
   * on it changed. Returns whether anything still moves.
   */
  tick(deltaMs: number, pan: Point, motion: boolean): boolean {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.clock += deltaMs;
    let busy = this.stepLevels(dt);
    busy = this.stepMagnet(dt, motion) || busy;
    busy = this.stepEvent(deltaMs, motion) || busy;
    busy = this.stepSurge(dt, motion) || busy;
    if (pan.x !== this.pan.x || pan.y !== this.pan.y) {
      this.pan = { x: pan.x, y: pan.y };
      this.dirty = true;
    }
    if (this.dirty) {
      this.field.position.set(pan.x, pan.y);
      this.renderer.render({ container: this.field, target: this.target, clear: true });
      this.renderer.render({ container: this.blurAcross, target: this.across, clear: true });
      this.renderer.render({ container: this.blurDown, target: this.target, clear: true });
      this.dirty = false;
    }
    const u = this.values;
    (u.uPan as Float32Array).set([pan.x, pan.y]);
    (u.uMagnet as Float32Array).set([this.magnet.x, this.magnet.y]);
    (u.uMagnetVelocity as Float32Array).set([this.magnet.vx, this.magnet.vy]);
    u.uPull = Math.max(0, this.pull);
    u.uSurge = Math.max(0, this.surge);
    u.uHasFlags = this.flagged.size > 0 ? 1 : 0;
    this.writeWaves(pan);
    return busy;
  }

  /** Moves the game's end along, flooding and draining cells as a win's ring passes. */
  private stepEvent(deltaMs: number, motion: boolean): boolean {
    const event = this.event;
    if (!event) return false;
    event.age += deltaMs;
    const w =
      event.kind === "win" ? winAt(event.age, this.inradius) : lossAt(event.age, this.inradius);
    if (w.done || !motion) {
      this.endEvent();
      return false;
    }
    this.waves = w;
    while (
      this.flooded < this.floodOrder.length &&
      (this.floodOrder[this.flooded]?.distance ?? Infinity) <= w.flood
    ) {
      this.setFlood((this.floodOrder[this.flooded++] as { id: number }).id, FILM_LEVEL);
    }
    while (
      w.drain >= 0 &&
      this.drained < this.flooded &&
      (this.floodOrder[this.drained]?.distance ?? Infinity) <= w.drain
    ) {
      this.setFlood((this.floodOrder[this.drained++] as { id: number }).id, 0);
    }
    return true;
  }

  private endEvent(): void {
    for (let i = this.drained; i < this.flooded; i++)
      this.setFlood((this.floodOrder[i] as { id: number }).id, 0);
    this.event = null;
    this.waves = null;
    this.floodOrder = [];
    this.flooded = 0;
    this.drained = 0;
  }

  private setFlood(id: number, level: number): void {
    const cell = this.cells[id];
    if (!cell) return;
    this.flood[id] = level;
    this.goal[id] = Math.max(levelOf(cell.state), level);
    this.moving.add(id);
    this.dirty = true;
  }

  /** Hands the shader the shapes of the game's end, in host pixels. */
  private writeWaves(pan: Point): void {
    const u = this.values;
    const w = this.waves;
    const event = this.event;
    const rings = u.uRings as Float32Array;
    if (!w || !event) {
      rings.set([-1, -1, -1, -1]);
      (u.uCrown as Float32Array).set([0, 0]);
      (u.uCrater as Float32Array).set([0, 1]);
      (u.uJet as Float32Array).set([0, 1]);
      (u.uDrop as Float32Array).set([0, 0]);
      return;
    }
    (u.uCenter as Float32Array).set([event.x + pan.x, event.y + pan.y]);
    rings.set(w.rings);
    (u.uRingHeights as Float32Array).set(w.heights);
    u.uWavelength = w.wavelength;
    u.uReflect = w.reflect;
    const b = this.bounds;
    (u.uBounds as Float32Array).set([
      b.minX + pan.x,
      b.minY + pan.y,
      b.maxX + pan.x,
      b.maxY + pan.y,
    ]);
    (u.uCrater as Float32Array).set([w.crater.depth, w.crater.width]);
    (u.uCrown as Float32Array).set([w.crown.radius, w.crown.height]);
    (u.uJet as Float32Array).set([w.jet.height, w.jet.radius]);
    (u.uDrop as Float32Array).set(w.drop ? [w.drop.z, w.drop.radius] : [0, 0]);
  }

  private stepSurge(dt: number, motion: boolean): boolean {
    if (!motion) {
      this.surge = 0;
      this.surgeVelocity = 0;
      return false;
    }
    this.surgeVelocity += (-SURGE.stiffness * this.surge - SURGE.damping * this.surgeVelocity) * dt;
    this.surge += this.surgeVelocity * dt;
    if (Math.abs(this.surge) < 0.002 && Math.abs(this.surgeVelocity) < 0.01) {
      this.surge = 0;
      this.surgeVelocity = 0;
      return false;
    }
    return true;
  }

  private stepLevels(dt: number): boolean {
    for (const id of this.moving) {
      const goal = this.goal[id] as number;
      const level = this.level[id] as number;
      const rate = 1 - Math.exp(-dt / (goal < level ? DRAIN_S : FILL_S));
      let next = level + (goal - level) * rate;
      if (Math.abs(goal - next) < 0.01) next = goal;
      this.level[id] = next;
      const flagGoal = this.flagGoal[id] as number;
      const flag = this.flag[id] as number;
      let flagNext = flag + (flagGoal - flag) * (1 - Math.exp(-dt / FILL_S));
      if (Math.abs(flagGoal - flagNext) < 0.01) flagNext = flagGoal;
      this.flag[id] = flagNext;
      this.paint(id);
      if (next === goal && flagNext === flagGoal) this.moving.delete(id);
    }
    if (this.moving.size > 0) this.dirty = true;
    return this.moving.size > 0;
  }

  private stepMagnet(dt: number, motion: boolean): boolean {
    const goal = this.aim ? 1 : 0;
    if (!motion) {
      if (this.aim) this.magnet = { x: this.aim.x, y: this.aim.y, vx: 0, vy: 0 };
      this.pull = goal;
      this.pullVelocity = 0;
      return false;
    }
    const m = this.magnet;
    if (this.aim) {
      m.vx += (FOLLOW.stiffness * (this.aim.x - m.x) - FOLLOW.damping * m.vx) * dt;
      m.vy += (FOLLOW.stiffness * (this.aim.y - m.y) - FOLLOW.damping * m.vy) * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    this.pullVelocity +=
      (PULL.stiffness * (goal - this.pull) - PULL.damping * this.pullVelocity) * dt;
    this.pull += this.pullVelocity * dt;
    const still =
      Math.abs(this.pull - goal) < 0.002 &&
      Math.abs(this.pullVelocity) < 0.01 &&
      (!this.aim ||
        (Math.hypot(this.aim.x - m.x, this.aim.y - m.y) < 0.2 && Math.hypot(m.vx, m.vy) < 1));
    if (still) {
      this.pull = goal;
      this.pullVelocity = 0;
    }
    return !still;
  }

  /**
   * Writes a cell's level into the red channel, its flag into the green one,
   * and its spike's seed, which a flag takes over, into the blue one.
   */
  private paint(id: number): void {
    const blob = this.blobFor[id];
    const level = this.level[id] as number;
    if (blob) {
      blob.tint = Math.round(level * 255) << 16;
      blob.visible = level > 0;
    }
    const flag = this.flag[id] as number;
    const core = this.coreFor[id];
    if (core) {
      const spike = level * (1 - flag);
      core.tint = Math.round(spike * 255);
      core.visible = spike > 0;
    }
    let seed = this.seedFor.get(id);
    if (flag > 0 && !seed) {
      const cell = this.cells[id] as FluidCell;
      seed = new Graphics({ context: this.seedContext, blendMode: "add" });
      seed.position.copyFrom(cell.center);
      seed.scale.set(cell.inradius * SEED);
      this.seeds.addChild(seed);
      this.seedFor.set(id, seed);
    }
    if (seed) {
      seed.tint = Math.round(flag * 255) << 8;
      seed.visible = flag > 0;
    }
    if (flag > 0) this.flagged.add(id);
    else this.flagged.delete(id);
  }

  destroy(): void {
    this.surface.destroy();
    this.field.destroy({ children: true });
    for (const context of this.contexts.values()) context.destroy();
    this.seedContext.destroy();
    this.blurAcross.destroy({ children: true });
    this.blurDown.destroy({ children: true });
    this.shader.destroy();
    this.target.destroy(true);
    this.across.destroy(true);
  }
}

interface BlurResources {
  blur: { uniforms: { uStep: Float32Array } };
}

function unitQuad(): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

/** One direction of the field's Gaussian blur, reading `source`. */
function blurPass(source: RenderTexture): Mesh<MeshGeometry, Shader> {
  const shader = Shader.from({
    gl: { vertex: FERROFLUID_VERTEX, fragment: BLUR_FRAGMENT, name: "ferrofluid-blur" },
    resources: {
      uSource: source.source,
      blur: { uStep: { value: new Float32Array(2), type: "vec2<f32>" } },
    },
  });
  const pass = new Mesh({ geometry: unitQuad(), shader });
  // The field is data, not color: write it as is.
  pass.blendMode = "none";
  return pass;
}

function levelOf(state: FluidState): number {
  return state === "drained" ? 0 : state === "pressed" ? PRESSED_LEVEL : 1;
}
