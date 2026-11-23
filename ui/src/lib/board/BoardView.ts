import "pixi.js/unsafe-eval";
import {
  Application,
  Container,
  FederatedPointerEvent,
  FillGradient,
  Graphics,
  GraphicsContext,
  Polygon,
  Sprite,
  Text,
  type FillInput,
  type RoundedPoint,
} from "pixi.js";
import type { Action } from "../bindings";
import type { CellChange } from "../bindings";
import type { CellView } from "../bindings";
import type { GameSnapshot } from "../bindings";
import type { GameStatus } from "../bindings";
import type { Point } from "../bindings";
import { numberColor } from "../themes/catalog";
import { countSwatch, prefersDarkInk } from "../themes/counts";
import { isGlyphName } from "../themes/entry";
import type { GlyphName } from "../themes/format";
import { hasGloss, hasLight, hasRim, hasShade } from "../themes/gloss";
import type { BoardTheme } from "../themes/types";
import { Animator, ease } from "./animator";
import {
  across,
  centroid,
  distanceToEdges,
  extent,
  halfPlane,
  insetConvex,
  intersectConvex,
  toward,
} from "./geometry";
import { Ferrofluid, type FluidState } from "./ferrofluid";
import { GlyphTextures } from "./glyphs";
import { fitBoard } from "./layout";
import { glareOutline, LightAtlas } from "./light";
import { Particles } from "./particles";

export interface BoardHandlers {
  primary(cell: number): void;
  secondary(cell: number): void;
  /** Right click off any cell, or anywhere while the board is locked. */
  fieldSecondary(): void;
  /** Any mouse button or finger went down on the board, on `cell` or off every cell. */
  pointerPress(cell: number | null): void;
  /** Cells moved on screen, so anchors from `anchorOf` are stale. */
  layoutChanged(): void;
  /**
   * The count on the cell under the pointer or the keyboard focus, whichever
   * moved last. Null when that cell shows no count, or while the board is locked.
   */
  inspect(count: number | null): void;
}

/** Where a cell sits in the board host, in CSS pixels. */
export interface CellAnchor {
  x: number;
  y: number;
  radius: number;
}

type ShapeState = "closed" | "closedHover" | "closedPressed" | "open" | "exploded";

interface Shape {
  outline: Point[];
  sheen: Point[];
  /** The glare on closed cells, or null when the theme has none. */
  glare: RoundedPoint[] | null;
  radius: number;
}

interface CellSprite {
  id: number;
  root: Container;
  shape: Graphics;
  glyph: Container;
  /**
   * With the ferrofluid, the glyph's own spot in the glyph layer above the
   * fluid, which follows the cell's scale and opacity; null otherwise, when
   * the glyph sits in the cell's root.
   */
  glyphRoot: Container | null;
  shapeKey: string;
  /** Center in board-local pixels, before panning. */
  center: Point;
  inradius: number;
  corners: number;
  view: CellView;
  hovered: boolean;
  pressed: boolean;
}

/** How much a digit swells as a win's ring crests under it. */
const FLARE = 0.45;
/** Space kept between the board and the edge of its host, in CSS pixels. */
export const PADDING = 4;
/** A touch held this long on a cell flags it instead of opening it. */
const LONG_PRESS_MS = 450;
/** A touch that moves farther than this, in CSS pixels, is no longer a press. */
const TOUCH_SLOP = 10;
/** Two fingers spreading or closing by this ratio take one zoom step. */
const PINCH_STEP = 1.25;
/** Smallest cell before the board stops shrinking and starts to scroll. */
const MIN_INRADIUS = 5;
const REVEAL_STEP_MS = 22;
const REVEAL_MAX_MS = 900;
const BOOM_STEP_MS = 38;
const BOOM_MAX_MS = 1400;
/** Idle frames to render before stopping the ticker. */
const IDLE_FRAMES = 2;
/**
 * Cells per render group. Pixi batches a group's cells again whenever one of
 * them changes its drawing, so a hover on a large board batches a group of
 * this size instead of the whole board.
 */
const GROUP_CELLS = 1024;
/** Each zoom step multiplies the cell size by this. */
const ZOOM_STEP = 1.25;
/** Largest cell, as an inradius in pixels, that zooming in reaches. */
const MAX_INRADIUS = 64;
/** One hint pulse, dim to bright and back. */
const HINT_PULSE_PERIOD_MS = 1200;
/** Two and a half periods: three pulses that end on full brightness, then the ring holds. */
const HINT_PULSE_MS = 2.5 * HINT_PULSE_PERIOD_MS;

/** A dark halo under hint and focus rings keeps them visible on light and dark cells. */
const RING_HALO = { color: 0x000000, alpha: 0.55 };
/** The glint on a mine is a specular highlight, white in every theme. */
const MINE_GLINT = { color: 0xffffff, alpha: 0.85 };
/** Count fills let a little of the open cell through. */
const COUNT_FILL_ALPHA = 0.92;
/** A ring count's band, as a share of the cell's inradius; the rest stays open. */
const RING_BAND = 0.42;
/** Inks for the digit on an inspected count fill, picked per fill for contrast. */
const COUNT_INK = { dark: 0x000000, light: 0xffffff };
/**
 * Edges around text, as a share of its size: wide enough on a ring count to
 * part the digit from the band, and thin on the question mark, which keeps
 * its shape.
 */
const EDGE = { count: 0.16, question: 0.08 };
/** A theme's SVG glyph fits a square this many inradii wide, about the drawn mine's span. */
const SVG_GLYPH_SIZE = 1.3;
/** One sweep of the glint across a hovered cell. */
const GLINT_MS = 520;
/** The glint's band, as a share of the cell's inradius, and its slant from the light's direction. */
const GLINT = { width: 0.32, slant: 0.45 };
/** A digit's shadow falls this share of its size away from the light, blurred by half as much. */
const NUMBER_SHADOW = 0.05;

function fluidState(cell: CellSprite): FluidState {
  if (cell.view.kind !== "closed") return "drained";
  if (cell.view.mark === "flag") return "flagged";
  return cell.pressed ? "pressed" : "full";
}

function shapeState(view: CellView, hovered: boolean, pressed: boolean): ShapeState {
  if (view.kind === "closed") return pressed ? "closedPressed" : hovered ? "closedHover" : "closed";
  return view.kind === "mine" && view.exploded ? "exploded" : "open";
}

/** Draws the board with Pixi and turns pointer input into game actions. */
export class BoardView {
  private readonly world = new Container();
  private readonly viewport = new Container();
  private readonly cellLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly fxLayer = new Container();
  /** The ferrofluid's digits and marks, above the fluid; empty without it. */
  private readonly glyphLayer = new Container();
  private readonly animator = new Animator();
  private readonly particles = new Particles(this.fxLayer);
  private readonly glyphTextures = new GlyphTextures(() => this.redrawGlyphs());
  private readonly resizeObserver: ResizeObserver;
  private readonly motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Matches the current pixel density, so a move to another display fires `change`. */
  private resolutionQuery: MediaQueryList | null = null;

  private snapshot: GameSnapshot | null = null;
  private views: CellView[] = [];
  private cells: CellSprite[] = [];
  private shapes = new Map<string, Shape>();
  private contexts = new Map<string, GraphicsContext>();
  private pressedCell: number | null = null;
  private preview: number[] = [];
  private hint: { cell: number; action: Action; ring: Graphics; shownAt: number } | null = null;
  private glint: { cell: number; band: Graphics; shownAt: number } | null = null;
  /** The theme's light on cells, built with the first drawing that needs it. */
  private light: LightAtlas | null = null;
  private spot: FillGradient | null = null;
  /** The ferrofluid effect when the theme asks for it; it draws closed cells in their place. */
  private ferro: Ferrofluid | null = null;
  /** Where the pointer is over the board, in host pixels, or null once it leaves. */
  private pointerAt: Point | null = null;
  /** Whether a digit may still be swollen from the last frame of a win's ring. */
  private flaring = false;
  private focus: { cell: number; ring: Graphics } | null = null;
  private pointerCell: number | null = null;
  /** The cell a press went down on, until the press bubbles up to the stage. */
  private pressTarget: number | null = null;
  /** The cell under the pointer or the keyboard focus, whichever moved last. */
  private inspected: number | null = null;
  /** The count last sent to `handlers.inspect`; undefined before the first. */
  private reported: number | null | undefined;
  private shake = { time: 0, strength: 0 };
  private pan = { x: 0, y: 0, minX: 0, minY: 0 };
  private drag: { x: number; y: number; panX: number; panY: number } | null = null;
  /** A touch held on a cell, which flags it once the timer fires. */
  private hold: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** The hold already flagged, so lifting the finger must not open the cell. */
  private heldToFlag = false;
  /** Fingers on the board, by pointer id, for pinch zoom. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private clock = 0;
  private idleFrames = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private laidOutSize = { width: 0, height: 0 };
  private locked = false;
  /** The board's width and height in board units, from the last layout. */
  private extent: { width: number; height: number } | null = null;
  /** 1 fits the board to the window; larger values zoom in. */
  private zoom = 1;
  private maxZoom = 1;

  private constructor(
    private readonly app: Application,
    private readonly host: HTMLElement,
    private theme: BoardTheme,
    private readonly handlers: BoardHandlers,
  ) {
    app.ticker.maxFPS = 60;
    app.stage.addChild(this.world);
    this.world.addChild(this.viewport);
    this.viewport.addChild(this.cellLayer, this.glyphLayer, this.overlayLayer, this.fxLayer);
    // Rings, glows, and particles sit above the cells. Pixi's hit test stops at
    // the first shape under the pointer, so these layers must never take part.
    this.overlayLayer.eventMode = "none";
    this.fxLayer.eventMode = "none";
    this.glyphLayer.eventMode = "none";
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointerdown", (e) => this.onStagePointerDown(e));
    // With global moves off, the stage hears only moves over the canvas. A
    // drag or a touch also listens on the window, in `trackWindow`.
    app.stage.on("pointermove", (e) => this.onStagePointerMove(e));
    app.stage.on("pointerup", (e) => this.endPointer(e));
    app.stage.on("pointerupoutside", (e) => this.endPointer(e));
    app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    app.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // Pixi 8 doesn't listen for pointercancel, so a touch the system takes
    // back for a gesture would otherwise stay down forever.
    app.canvas.addEventListener("pointercancel", (e) => this.cancelPointer(e));
    app.canvas.addEventListener("pointerleave", () => {
      this.pointerAt = null;
      this.aimMagnet();
    });
    window.addEventListener("blur", this.onWindowBlur);
    app.ticker.add((ticker) => this.tick(ticker.deltaMS));
    this.motionQuery.addEventListener("change", this.onMotionChange);
    this.watchResolution();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRelayout());
    this.resizeObserver.observe(host);
  }

  static async create(host: HTMLElement, theme: BoardTheme, handlers: BoardHandlers) {
    const app = new Application();
    await app.init({
      // Global move events hit-test every cell on each pointer move.
      eventFeatures: { globalMove: false },
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(app.canvas);
    return new BoardView(app, host, theme, handlers);
  }

  destroy(): void {
    clearTimeout(this.resizeTimer);
    this.cancelHold();
    this.resizeObserver.disconnect();
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("pointermove", this.onWindowPointerMove, true);
    this.dropContexts();
    this.ferro?.destroy();
    this.app.destroy(true, { children: true });
  }

  private get motion(): boolean {
    return !this.motionQuery.matches;
  }

  private readonly onMotionChange = () => this.wake();

  private watchResolution(): void {
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    this.resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.resolutionQuery.addEventListener("change", this.onResolutionChange);
  }

  /** The window moved to a display with another pixel density. */
  private readonly onResolutionChange = () => {
    this.watchResolution();
    const { clientWidth: width, clientHeight: height } = this.host;
    this.app.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.rebuild();
  };

  setTheme(theme: BoardTheme): void {
    this.theme = theme;
    this.rebuild();
  }

  /** Shows a fresh board, with cells rippling in from the middle. */
  load(snapshot: GameSnapshot): void {
    this.snapshot = snapshot;
    this.views = [...snapshot.views];
    this.animator.clear();
    this.particles.clear();
    this.clearHint();
    this.pointerCell = null;
    this.inspected = null;
    this.setFocus(null);
    this.pan.x = 0;
    this.pan.y = 0;
    this.rebuild();
    if (this.motion) this.animateEntrance();
  }

  /** Blocks input and hides the cells, for example while the game is paused. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    this.releasePress();
    const from = this.cellLayer.alpha;
    const to = locked ? 0 : 1;
    this.animator.tween({
      duration: this.motion ? 200 : 1,
      update: (p) => {
        this.cellLayer.alpha = from + (to - from) * p;
        this.overlayLayer.alpha = this.cellLayer.alpha;
        this.glyphLayer.alpha = this.cellLayer.alpha;
        if (this.ferro) this.ferro.surface.alpha = this.cellLayer.alpha;
      },
    });
    this.aimMagnet();
    // A paused board hides its cells, so the readout must not name them.
    this.reportInspected();
    this.wake();
  }

  /** Animates the result of one action. */
  apply(changes: readonly CellChange[], status: GameStatus): void {
    this.clearHint();
    let lastDelay = 0;
    for (const change of changes) {
      const boom = change.view.kind === "mine" || change.view.kind === "wrongFlag";
      const delay = !this.motion
        ? 0
        : boom
          ? Math.min(change.wave * BOOM_STEP_MS, BOOM_MAX_MS)
          : Math.min(change.wave * REVEAL_STEP_MS, REVEAL_MAX_MS);
      lastDelay = Math.max(lastDelay, delay);
      this.views[change.cell] = change.view;
      this.animator.after(delay, () => this.reveal(change.cell, change.view));
    }
    if (status === "lost") {
      const exploded = changes.find((c) => c.view.kind === "mine" && c.view.exploded);
      if (exploded) this.explode(exploded.cell);
    } else if (status === "won" && this.motion) {
      this.animator.after(lastDelay + 120, () => this.celebrate());
    }
    this.wake();
  }

  /** Highlights the bot's suggestion with a few pulses, then holds it until the next action. */
  showHint(cell: number, action: Action): void {
    this.placeHint(cell, action, this.clock);
  }

  private placeHint(cell: number, action: Action, shownAt: number): void {
    this.clearHint();
    const sprite = this.cells[cell];
    if (!sprite) return;
    const color = action === "open" ? this.theme.hint : this.theme.flag;
    const ring = this.ring(sprite, color, 3);
    this.overlayLayer.addChild(ring);
    this.hint = { cell, action, ring, shownAt };
    this.scrollIntoView(cell);
    this.wake();
  }

  clearHint(): void {
    this.hint?.ring.destroy();
    this.hint = null;
    this.wake();
  }

  /** Draws the keyboard focus ring on `cell`, or removes it. */
  setFocus(cell: number | null): void {
    this.focus?.ring.destroy();
    this.focus = null;
    const sprite = cell === null ? undefined : this.cells[cell];
    if (cell !== null && sprite) {
      const ring = this.ring(sprite, this.theme.focus, 2);
      this.overlayLayer.addChild(ring);
      this.focus = { cell, ring };
      this.scrollIntoView(cell);
    }
    this.inspect(cell ?? this.pointerCell);
    this.aimMagnet();
    this.wake();
  }

  /** Points the fluid's magnet at the pointer, or else at the keyboard focus. */
  private aimMagnet(): void {
    if (!this.ferro) return;
    const focused = this.focus ? this.cells[this.focus.cell] : undefined;
    const at =
      this.pointerAt ??
      (focused
        ? { x: focused.center.x + this.viewport.x, y: focused.center.y + this.viewport.y }
        : null);
    this.ferro.point(this.locked ? null : at);
    this.wake();
  }

  /** Points the readout at `cell`, and moves the digit a color-only theme shows there. */
  private inspect(cell: number | null): void {
    const before = this.inspected;
    this.inspected = cell;
    if (before !== cell && this.theme.numberStyle === "colors") {
      for (const id of [before, cell]) {
        const sprite = id === null ? undefined : this.cells[id];
        if (sprite?.view.kind === "open" && sprite.view.adjacent > 0) this.drawGlyph(sprite);
      }
      this.wake();
    }
    this.reportInspected();
  }

  private reportInspected(): void {
    const view = this.inspected === null ? undefined : this.cells[this.inspected]?.view;
    const count = !this.locked && view?.kind === "open" && view.adjacent > 0 ? view.adjacent : null;
    if (count === this.reported) return;
    this.reported = count;
    this.handlers.inspect(count);
  }

  /**
   * The host size, in CSS pixels, that fits the board with no room to spare
   * along the asked axes. Across alone keeps the height and takes the width
   * the board has at the scale the height allows; down alone does the same
   * the other way; both keep the board's scale and trim the room around it.
   */
  fittedHost(across: boolean, down: boolean): { width: number; height: number } | null {
    const extent = this.extent;
    if (!extent || extent.width <= 0 || extent.height <= 0) return null;
    const { clientWidth: width, clientHeight: height } = this.host;
    const roomX = (width - 2 * PADDING) / extent.width;
    const roomY = (height - 2 * PADDING) / extent.height;
    const scale = across && down ? Math.min(roomX, roomY) : across ? roomY : roomX;
    return {
      width: across ? extent.width * scale + 2 * PADDING : width,
      height: down ? extent.height * scale + 2 * PADDING : height,
    };
  }

  /** Position of a cell in the host element, for placing DOM labels next to it. */
  anchorOf(cell: number): CellAnchor | null {
    const sprite = this.cells[cell];
    if (!sprite) return null;
    return {
      x: sprite.center.x + this.viewport.x,
      y: sprite.center.y + this.viewport.y,
      radius: sprite.inradius,
    };
  }

  private ring(sprite: CellSprite, color: number, width: number): Graphics {
    const outline = insetConvex(this.shapes.get(sprite.shapeKey)?.outline ?? [], -width);
    const ring = new Graphics()
      .roundShape(outline, 3, true)
      .stroke({ width: width + 2, ...RING_HALO })
      .roundShape(outline, 3, true)
      .stroke({ width, color });
    ring.position.copyFrom(sprite.center);
    return ring;
  }

  /** Restarts the ticker; it stops itself again once nothing moves. */
  private wake(): void {
    this.idleFrames = 0;
    if (!this.app.ticker.started) this.app.ticker.start();
  }

  private tick(deltaMs: number): void {
    this.clock += deltaMs;
    this.animator.tick(deltaMs);
    this.particles.tick(deltaMs);
    const pulseAge = this.hint ? this.clock - this.hint.shownAt : Infinity;
    const pulsing = this.motion && pulseAge < HINT_PULSE_MS;
    if (this.hint) {
      const phase = (2 * Math.PI * pulseAge) / HINT_PULSE_PERIOD_MS;
      const pulse = pulsing ? (1 - Math.cos(phase)) / 2 : 1;
      this.hint.ring.alpha = 0.45 + 0.55 * pulse;
      this.hint.ring.scale.set(1 + 0.06 * pulse);
    }
    const glinting = this.moveGlint();
    let flowing = false;
    if (this.ferro) {
      const playing = this.ferro.playing;
      if (this.animator.busy || playing || this.flaring) {
        for (const cell of this.cells) {
          this.ferro.follow(cell.id, cell.root.scale.x, cell.root.alpha);
          this.followGlyph(cell, playing);
        }
      }
      this.flaring = playing;
      flowing = this.ferro.tick(deltaMs, this.viewport.position, this.motion);
      // The surface spans the host, so it stays put while the cells pan under it.
      this.ferro.surface.position.set(-this.viewport.x, -this.viewport.y);
    }
    if (this.shake.time > 0) {
      this.shake.time = Math.max(0, this.shake.time - deltaMs);
      const k = this.shake.strength * (this.shake.time / 200);
      this.world.position.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    } else if (this.world.x !== 0 || this.world.y !== 0) {
      this.world.position.set(0, 0);
    }
    const busy =
      this.animator.busy ||
      this.particles.active ||
      this.shake.time > 0 ||
      pulsing ||
      glinting ||
      flowing ||
      this.drag;
    if (busy) {
      this.idleFrames = 0;
    } else if (++this.idleFrames > IDLE_FRAMES) {
      this.app.ticker.stop();
    }
  }

  /** Keeps a glyph over its cell, and swells a digit as a win's ring crests under it. */
  private followGlyph(cell: CellSprite, playing: boolean): void {
    const spot = cell.glyphRoot;
    if (!spot) return;
    const digit = cell.view.kind === "open" && cell.view.adjacent > 0;
    const crest =
      playing && digit && this.ferro
        ? this.ferro.crest({
            x: cell.center.x + this.viewport.x,
            y: cell.center.y + this.viewport.y,
          })
        : 0;
    spot.scale.set(cell.root.scale.x * (1 + FLARE * crest));
    spot.alpha = cell.root.alpha;
  }

  private scheduleRelayout(): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const { clientWidth: width, clientHeight: height } = this.host;
      const same = width === this.laidOutSize.width && height === this.laidOutSize.height;
      if (this.snapshot && !same) this.rebuild();
    }, 60);
  }

  /**
   * Frees the shared drawings. Call it before destroying the cells. A drawing
   * drops all its listeners at once, but a cell destroyed first unsubscribes
   * alone, which walks every cell that shares its drawing.
   */
  private dropContexts(): void {
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
    this.shapes.clear();
    this.glyphTextures.clearTextures();
    this.light?.destroy();
    this.light = null;
    this.spot?.destroy();
    this.spot = null;
  }

  /** Draws every cell's glyph again, once a theme's SVG has loaded. */
  private redrawGlyphs(): void {
    for (const cell of this.cells) this.drawGlyph(cell);
    this.wake();
  }

  private rebuild(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    // Pending animations point at sprites about to be replaced. The new
    // sprites are drawn in their final state, so nothing is lost. Effects
    // whose fade was cut short go too, or they'd linger over the new cells.
    this.animator.clear();
    this.particles.clear();
    for (const child of this.fxLayer.removeChildren()) child.destroy();
    const focused = this.focus?.cell ?? null;
    this.focus = null;
    this.glint = null;
    const groups = this.cellLayer.removeChildren();
    for (const child of this.overlayLayer.removeChildren()) child.destroy();
    for (const child of this.glyphLayer.removeChildren()) child.destroy({ children: true });
    this.dropContexts();
    for (const group of groups) group.destroy({ children: true });

    const { clientWidth: width, clientHeight: height } = this.host;
    this.laidOutSize = { width, height };
    const scale = this.layout(snapshot, width, height);
    const gap = this.theme.gap;

    let group = this.cellLayer;
    // The ferrofluid draws between cells and glyphs, so glyphs move to a layer above it.
    const fluid = this.theme.effects.includes("ferrofluid");
    this.cells = snapshot.cells.map((cell, id) => {
      if (id % GROUP_CELLS === 0) {
        group = new Container({ isRenderGroup: true });
        this.cellLayer.addChild(group);
      }
      const screen = cell.polygon.map((p) => ({
        x: p.x * scale.factor + scale.x,
        y: p.y * scale.factor + scale.y,
      }));
      const center = centroid(screen);
      const local = screen.map((p) => ({ x: p.x - center.x, y: p.y - center.y }));
      const shapeKey = this.shapeFor(local, gap);
      const shape = this.shapes.get(shapeKey) as Shape;
      const view = this.views[id] ?? { kind: "closed", mark: "none" };
      const sprite: CellSprite = {
        id,
        root: new Container(),
        // A Graphics made without its drawing would allocate an empty one of its own.
        shape: new Graphics(this.context(shapeKey, shapeState(view, false, false))),
        glyph: new Container(),
        glyphRoot: fluid ? new Container() : null,
        shapeKey,
        center,
        inradius: distanceToEdges(shape.outline, { x: 0, y: 0 }),
        corners: local.length,
        view,
        hovered: false,
        pressed: false,
      };
      sprite.root.position.copyFrom(center);
      if (sprite.glyphRoot) {
        sprite.root.addChild(sprite.shape);
        sprite.glyphRoot.position.copyFrom(center);
        sprite.glyphRoot.addChild(sprite.glyph);
        this.glyphLayer.addChild(sprite.glyphRoot);
      } else {
        sprite.root.addChild(sprite.shape, sprite.glyph);
      }
      sprite.root.eventMode = "static";
      sprite.root.hitArea = new Polygon(local.flatMap((p) => [p.x, p.y]));
      sprite.root.on("pointerdown", (e) => this.onPointerDown(id, e));
      sprite.root.on("pointerup", (e) => this.onPointerUp(id, e));
      sprite.root.on("pointerover", (e) => this.onPointerOver(id, e));
      sprite.root.on("pointerout", () => this.onPointerOut(id));
      group.addChild(sprite.root);
      this.drawGlyph(sprite);
      return sprite;
    });
    this.cellLayer.alpha = this.locked ? 0 : 1;
    this.overlayLayer.alpha = this.cellLayer.alpha;
    this.glyphLayer.alpha = this.cellLayer.alpha;
    this.layoutFluid(width, height);
    if (this.hint) {
      const { cell, action, shownAt } = this.hint;
      this.hint = null;
      this.placeHint(cell, action, shownAt);
    }
    if (focused !== null) this.setFocus(focused);
    this.applyPan();
    this.wake();
  }

  /** Starts, moves, or stops the ferrofluid to match the theme and the new cells. */
  private layoutFluid(width: number, height: number): void {
    if (!this.theme.effects.includes("ferrofluid")) {
      this.ferro?.destroy();
      this.ferro = null;
      return;
    }
    if (this.ferro) {
      this.ferro.setTheme(this.theme);
    } else {
      this.ferro = new Ferrofluid(this.app.renderer, this.theme);
      // Over the open cells' plates and under the glyphs.
      this.viewport.addChildAt(this.ferro.surface, 1);
    }
    this.ferro.surface.alpha = this.cellLayer.alpha;
    this.ferro.layout(
      this.cells.map((cell) => ({
        center: cell.center,
        outline: (this.shapes.get(cell.shapeKey) as Shape).outline,
        inradius: cell.inradius,
        state: fluidState(cell),
      })),
      width,
      height,
    );
    for (const cell of this.cells) cell.shape.visible = cell.view.kind !== "closed";
    this.aimMagnet();
  }

  /**
   * Fits the board into the host, but never below the minimum cell size.
   * When the board ends up larger than the host it scrolls instead.
   */
  private layout(snapshot: GameSnapshot, width: number, height: number) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of snapshot.cells) {
      for (const p of cell.polygon) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const sample = snapshot.cells
      .slice(0, 16)
      .map((c) => distanceToEdges(c.polygon, centroid(c.polygon)));
    const unitInradius = Math.min(...sample);
    this.extent = { width: maxX - minX, height: maxY - minY };
    const fit = fitBoard({ minX, minY, maxX, maxY }, width, height, PADDING);
    const base = Math.max(fit.scale, (MIN_INRADIUS + this.theme.gap / 2) / unitInradius);
    this.maxZoom = Math.max(1, MAX_INRADIUS / (base * unitInradius));
    this.zoom = Math.min(this.zoom, this.maxZoom);
    const factor = base * this.zoom;
    const boardW = (maxX - minX) * factor;
    const boardH = (maxY - minY) * factor;
    const x =
      boardW + 2 * PADDING <= width
        ? (width - boardW) / 2 - minX * factor
        : PADDING - minX * factor;
    const y =
      boardH + 2 * PADDING <= height
        ? (height - boardH) / 2 - minY * factor
        : PADDING - minY * factor;
    this.pan.minX = Math.min(0, width - boardW - 2 * PADDING);
    this.pan.minY = Math.min(0, height - boardH - 2 * PADDING);
    return { factor, x, y };
  }

  /** Registers a cell outline and returns its cache key. Equal shapes share one key. */
  private shapeFor(local: Point[], gap: number): string {
    const key = local.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";");
    if (!this.shapes.has(key)) {
      const outline = insetConvex(local, gap / 2);
      const inradius = distanceToEdges(outline, { x: 0, y: 0 });
      // Six triangle corners meet at each vertex; round them only as far as
      // the gap so no dark dots open up between cells.
      const radius =
        local.length === 3
          ? Math.min(gap / 2, inradius * this.theme.rounding)
          : Math.min(6, Math.max(0.5, inradius * this.theme.rounding));
      const sheen = insetConvex(outline, Math.max(1, inradius * this.theme.bevel));
      const corner = { subject: radius * 0.7, edge: radius * 0.4, clip: 0 };
      const glare = hasGloss(this.theme)
        ? glareOutline(outline, sheen, this.theme).map((p) => ({ ...p, radius: corner[p.from] }))
        : null;
      this.shapes.set(key, { outline, sheen, glare: glare?.length ? glare : null, radius });
    }
    return key;
  }

  /** One drawing per shape and state, shared by every cell that looks the same. */
  private context(shapeKey: string, state: ShapeState): GraphicsContext {
    const key = `${shapeKey}|${state}`;
    let context = this.contexts.get(key);
    if (context) return context;
    const t = this.theme;
    const { outline, sheen, glare, radius } = this.shapes.get(shapeKey) as Shape;
    context = new GraphicsContext();
    // Pixi gives a drawing of 200 or more vertices its own draw call, one per
    // cell. Batch mode makes every drawing join the batches whatever its size.
    context.batchMode = "batch";
    const { openAlpha, closedAlpha } = t;
    if (state === "open" || state === "exploded") {
      const color = state === "open" ? t.open : t.exploded;
      context.roundShape(outline, radius, true).fill(this.body(state, color, outline, openAlpha));
      context.stroke({ width: 1, color: t.openEdge, alpha: openAlpha });
    } else {
      const fill = { closed: t.closed, closedHover: t.closedHover, closedPressed: t.closedPressed }[
        state
      ];
      const hoverLift = state === "closedHover" ? 0.12 : 0;
      const alpha = Math.min(1, closedAlpha + hoverLift);
      context.roundShape(outline, radius, true).fill(this.body(state, fill, outline, alpha));
      context.stroke({ width: 1, color: t.closedEdge, alpha: 0.9 * closedAlpha });
      if (state !== "closedPressed") this.drawRaised(context, outline, sheen, glare, radius);
    }
    this.contexts.set(key, context);
    return context;
  }

  /** A cell's fill: its color, or with the theme's shade, its row of the light texture. */
  private body(state: ShapeState, color: number, outline: Point[], alpha: number): FillInput {
    const relief = state === "closed" || state === "closedHover" ? "raised" : "recessed";
    const light = hasShade(this.theme, relief) ? this.lightAtlas() : null;
    return light
      ? { ...light.style(state, outline, this.theme.lightAngle), alpha }
      : { color, alpha };
  }

  /** The rim light, the sheen, and the glare that a closed cell shows until it's pressed. */
  private drawRaised(
    context: GraphicsContext,
    outline: Point[],
    sheen: Point[],
    glare: RoundedPoint[] | null,
    radius: number,
  ): void {
    const t = this.theme;
    const light = hasLight(t) ? this.lightAtlas() : null;
    if (light && hasRim(t)) {
      const inradius = distanceToEdges(outline, { x: 0, y: 0 });
      const width = Math.min(t.rimWidth, inradius * 0.3);
      const rim = insetConvex(outline, width / 2);
      context
        .roundShape(rim, Math.max(0, radius - width / 2), true)
        .stroke({ width, ...light.style("rim", rim, t.rimAngle) });
    }
    if (t.sheenAlpha > 0) {
      context.roundShape(sheen, radius * 0.7, true).fill({ color: t.sheen, alpha: t.sheenAlpha });
    }
    if (light && glare) {
      const style =
        t.glossShape === "spot" ? this.spotGradient() : light.style("gloss", glare, t.lightAngle);
      context.roundShape(glare, 0, true).fill(style);
    }
  }

  private lightAtlas(): LightAtlas {
    this.light ??= new LightAtlas(this.theme);
    return this.light;
  }

  /** A round glare fades from its middle out, fitted to each glare's own bounds. */
  private spotGradient(): FillGradient {
    const { gloss, glossAlpha, glossFade } = this.theme;
    const rgba = (alpha: number) =>
      `rgba(${(gloss >> 16) & 255}, ${(gloss >> 8) & 255}, ${gloss & 255}, ${alpha})`;
    this.spot ??= new FillGradient({
      type: "radial",
      center: { x: 0.5, y: 0.5 },
      innerRadius: 0,
      outerCenter: { x: 0.5, y: 0.5 },
      outerRadius: 0.5,
      colorStops: [
        { offset: 0, color: rgba(glossAlpha) },
        { offset: 1, color: rgba(glossFade) },
      ],
      textureSpace: "local",
    });
    return this.spot;
  }

  private drawShape(cell: CellSprite): void {
    const state = shapeState(cell.view, cell.hovered, cell.pressed);
    cell.shape.context = this.context(cell.shapeKey, state);
    if (this.ferro) {
      cell.shape.visible = cell.view.kind !== "closed";
      this.ferro.setState(cell.id, fluidState(cell), this.motion);
    }
  }

  private drawGlyph(cell: CellSprite): void {
    for (const child of cell.glyph.removeChildren()) child.destroy();
    cell.glyph.scale.set(1);
    const view = cell.view;
    const r = cell.inradius;
    const flag = () => this.svgGlyph("flag", cell) ?? new Graphics(this.glyphContext("flag", r));
    switch (view.kind) {
      case "open": {
        if (view.adjacent === 0) break;
        const colors = this.theme.numberStyle === "colors";
        if (colors) cell.glyph.addChild(this.countFill(view.adjacent, cell));
        const name = String(view.adjacent);
        // A number's SVG takes the digit's place, and sits on the fill of a color theme.
        const svg = isGlyphName(name) ? this.svgGlyph(name, cell) : null;
        if (svg) cell.glyph.addChild(svg);
        else if (!colors) {
          const color = numberColor(this.theme, view.adjacent);
          const label = this.label(name, color, cell);
          if (this.theme.effects.includes("ferrofluid")) this.glow(label, color);
          else this.castShadow(label);
          cell.glyph.addChild(label);
        } else if (cell.id === this.inspected) {
          cell.glyph.addChild(this.peekLabel(view.adjacent, cell));
        }
        break;
      }
      case "closed":
        // The ferrofluid raises a spike for a flag instead.
        if (view.mark === "flag" && !this.theme.effects.includes("ferrofluid")) {
          cell.glyph.addChild(flag());
        }
        if (view.mark === "question") {
          cell.glyph.addChild(this.svgGlyph("question", cell) ?? this.question(cell));
        }
        break;
      case "mine":
        cell.glyph.addChild(
          this.svgGlyph("mine", cell) ?? new Graphics(this.glyphContext("mine", r)),
        );
        break;
      case "wrongFlag": {
        const faded = flag();
        faded.alpha = 0.45;
        cell.glyph.addChild(faded, new Graphics(this.glyphContext("cross", r)));
        break;
      }
    }
  }

  /** The theme's SVG for `name` sized to the cell, or null to draw the built-in glyph. */
  private svgGlyph(name: GlyphName, cell: CellSprite): Sprite | null {
    const glyph = this.theme.glyphs[name];
    if (!glyph) return null;
    const size = cell.inradius * SVG_GLYPH_SIZE;
    const { resolution } = this.app.renderer;
    const texture = this.glyphTextures.texture(glyph, size, resolution, this.theme.filter);
    return texture ? new Sprite({ texture, anchor: 0.5 }) : null;
  }

  /** The cell filled with its count's color, or ringed with it, for themes without digits. */
  private countFill(count: number, cell: CellSprite): Graphics {
    const { color, ring } = countSwatch(this.theme, count);
    const key = `count|${cell.shapeKey}|${color}|${ring}`;
    let context = this.contexts.get(key);
    if (!context) {
      const { outline, radius } = this.shapes.get(cell.shapeKey) as Shape;
      context = new GraphicsContext()
        .roundShape(outline, radius, true)
        .fill({ color, alpha: COUNT_FILL_ALPHA });
      if (ring) {
        const hole = insetConvex(outline, cell.inradius * RING_BAND);
        context.roundShape(hole, radius * (1 - RING_BAND), true).cut();
      }
      this.contexts.set(key, context);
    }
    return new Graphics(context);
  }

  /**
   * The count as a digit, for the inspected cell of a color-only theme. On a
   * ring the digit overlaps the band, so it takes an edge in the open color.
   */
  private peekLabel(count: number, cell: CellSprite): Text {
    const { color, ring } = countSwatch(this.theme, count);
    const under = ring ? this.theme.open : color;
    const ink = prefersDarkInk(under) ? COUNT_INK.dark : COUNT_INK.light;
    return this.label(String(count), ink, cell, ring ? this.theme.open : undefined);
  }

  /** `text` sized to the cell, with an `edge` color around each glyph when given. */
  private label(
    text: string,
    color: number,
    cell: CellSprite,
    edge?: number,
    edgeShare = EDGE.count,
  ): Text {
    const base = cell.inradius * (cell.corners === 3 ? 1.5 : 1.35);
    const size = Math.max(9, text.length > 1 ? base * 0.78 : base);
    return new Text({
      text,
      anchor: 0.5,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: size,
        fontWeight: this.theme.fontWeight,
        fill: color,
        ...(edge === undefined
          ? {}
          : { stroke: { color: edge, width: Math.max(1.5, size * edgeShare) } }),
      },
    });
  }

  private question(cell: CellSprite): Text {
    const { question, questionOutline } = this.theme;
    return this.label("?", question, cell, questionOutline ?? undefined, EDGE.question);
  }

  /** Gives a digit the theme's shadow, cast away from the light. */
  private castShadow(label: Text): void {
    const { numberShadow, numberShadowAlpha, lightAngle } = this.theme;
    if (numberShadowAlpha <= 0) return;
    const away = toward(lightAngle + 180);
    const size = Number(label.style.fontSize);
    label.style.dropShadow = {
      color: numberShadow,
      alpha: numberShadowAlpha,
      angle: Math.atan2(away.y, away.x),
      distance: Math.max(1, size * NUMBER_SHADOW),
      blur: Math.max(0.5, (size * NUMBER_SHADOW) / 2),
    };
  }

  /** Lights a digit from beneath in its own color, for the ferrofluid's drained cells. */
  private glow(label: Text, color: number): void {
    const size = Number(label.style.fontSize);
    const blur = size * 0.28;
    label.style.dropShadow = { color, alpha: 0.9, angle: 0, distance: 0, blur };
    // Room around the digit, or its texture clips the glow to a box.
    label.style.padding = Math.ceil(blur * 2);
  }

  private glyphContext(glyph: "flag" | "mine" | "cross", r: number): GraphicsContext {
    const key = `glyph|${glyph}|${r.toFixed(1)}`;
    let context = this.contexts.get(key);
    if (context) return context;
    const t = this.theme;
    const s = r * 0.95;
    context = new GraphicsContext();
    if (glyph === "flag") {
      context
        .moveTo(-s * 0.18, s * 0.62)
        .lineTo(-s * 0.18, -s * 0.62)
        .stroke({ width: Math.max(1.5, s * 0.11), color: t.flagPole, cap: "round" });
      context
        .poly([-s * 0.14, -s * 0.64, s * 0.58, -s * 0.34, -s * 0.14, -s * 0.06])
        .fill({ color: t.flag })
        .stroke({ width: 1, color: t.flagOutline, join: "round" });
      context
        .roundRect(-s * 0.48, s * 0.56, s * 0.6, s * 0.14, s * 0.06)
        .fill({ color: t.flagPole, alpha: 0.85 });
    } else if (glyph === "mine") {
      for (let i = 0; i < t.mineSpikes; i++) {
        const a = (2 * Math.PI * i) / t.mineSpikes;
        context
          .moveTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3)
          .lineTo(Math.cos(a) * s * 0.68, Math.sin(a) * s * 0.68);
      }
      context.stroke({ width: Math.max(2, s * 0.14), color: t.mineSpark, cap: "round" });
      context
        .circle(0, 0, s * 0.4)
        .fill({ color: t.mine })
        .stroke({ width: Math.max(1.5, s * 0.08), color: t.mineSpark });
      context.circle(-s * 0.12, -s * 0.12, s * 0.1).fill(MINE_GLINT);
    } else {
      context
        .moveTo(-s * 0.5, -s * 0.5)
        .lineTo(s * 0.5, s * 0.5)
        .moveTo(s * 0.5, -s * 0.5)
        .lineTo(-s * 0.5, s * 0.5)
        .stroke({ width: Math.max(2, s * 0.14), color: t.exploded, cap: "round" });
    }
    this.contexts.set(key, context);
    return context;
  }

  private reveal(id: number, view: CellView): void {
    const cell = this.cells[id];
    if (!cell) return;
    const before = cell.view;
    cell.view = view;
    cell.pressed = false;
    this.drawShape(cell);
    this.drawGlyph(cell);
    if (id === this.inspected) this.reportInspected();

    if (!this.motion) {
      cell.root.alpha = 0;
      this.animator.tween({
        duration: 120,
        easing: ease.linear,
        update: (p) => (cell.root.alpha = p),
      });
      return;
    }
    if (view.kind === "open") {
      this.animator.tween({
        duration: 260,
        easing: ease.outBack,
        update: (p) => {
          cell.root.scale.set(0.6 + 0.4 * p);
          cell.root.alpha = 0.35 + 0.65 * p;
        },
      });
    } else if (view.kind === "closed" && view.mark !== "none" && before.kind === "closed") {
      this.animator.tween({
        duration: 220,
        easing: ease.outBack,
        update: (p) => cell.glyph.scale.set(1.5 - 0.5 * p),
      });
    } else if (view.kind === "mine" || view.kind === "wrongFlag") {
      this.animator.tween({
        duration: 280,
        easing: ease.outBack,
        update: (p) => cell.root.scale.set(1.2 - 0.2 * p),
      });
    }
  }

  /** A soft red glow from the exploded cell, a few sparks, and a small jolt. */
  private explode(id: number): void {
    const cell = this.cells[id];
    if (!cell) return;
    const { x, y } = cell.center;
    const t = this.theme;
    if (!this.motion) return;
    this.ferro?.burst({ x: x + this.viewport.x, y: y + this.viewport.y });
    const glow = new Graphics();
    const reach = cell.inradius * 6;
    for (let i = 6; i >= 1; i--)
      glow.circle(0, 0, (reach * i) / 6).fill({ color: t.exploded, alpha: 0.07 });
    glow.position.set(x, y);
    this.fxLayer.addChild(glow);
    this.animator.tween({
      duration: 650,
      update: (p) => {
        glow.scale.set(0.6 + 0.6 * p);
        glow.alpha = 1 - p;
      },
      done: () => glow.destroy(),
    });
    // The ferrofluid's ripples stand in for the sparks.
    if (!this.ferro)
      this.particles.burst(x, y, {
        count: 24,
        colors: [t.mineSpark, t.flag, t.question],
        speed: [90, 320],
        life: [400, 800],
        size: [2, 5],
        gravity: 300,
      });
    this.shake = { time: 200, strength: 4 };
  }

  private celebrate(): void {
    const { width, height } = this.app.screen;
    if (this.ferro) {
      // The splash stands in for the glow and the confetti.
      this.ferro.splash({ x: width / 2, y: height / 2 });
      return;
    }
    const mid = { x: width / 2 - this.viewport.x, y: height / 2 - this.viewport.y };
    const reach = Math.hypot(width, height) / 2;
    for (const cell of this.cells) {
      const shape = this.shapes.get(cell.shapeKey) as Shape;
      const glow = new Graphics()
        .roundShape(shape.outline, shape.radius, true)
        .fill({ color: this.theme.win });
      glow.position.copyFrom(cell.center);
      glow.alpha = 0;
      this.overlayLayer.addChild(glow);
      const distance = Math.hypot(cell.center.x - mid.x, cell.center.y - mid.y);
      this.animator.tween({
        delay: (distance / reach) * 600,
        duration: 700,
        easing: ease.linear,
        update: (p) => (glow.alpha = 0.4 * Math.sin(Math.PI * p)),
        done: () => glow.destroy(),
      });
    }
    const t = this.theme;
    const colors = [t.win, t.flag, t.question, ...t.numbers.slice(0, 4)];
    for (const fx of [0.25, 0.5, 0.75]) {
      this.particles.burst(width * fx - this.viewport.x, height * 0.35 - this.viewport.y, {
        count: 24,
        colors,
        speed: [160, 380],
        life: [1000, 1800],
        size: [6, 10],
        gravity: 420,
        angle: -Math.PI / 2,
        spread: 1.1,
        shape: "confetti",
      });
    }
  }

  private animateEntrance(): void {
    const { width, height } = this.app.screen;
    const reach = Math.hypot(width, height) / 2 || 1;
    for (const cell of this.cells) {
      cell.root.scale.set(0.2);
      cell.root.alpha = 0;
      const distance = Math.hypot(
        cell.center.x + this.viewport.x - width / 2,
        cell.center.y + this.viewport.y - height / 2,
      );
      this.animator.tween({
        delay: (distance / reach) * 320,
        duration: 340,
        easing: ease.outBack,
        update: (p) => {
          cell.root.scale.set(0.2 + 0.8 * p);
          cell.root.alpha = Math.min(1, p * 1.5);
        },
      });
    }
  }

  private applyPan(): void {
    this.pan.x = Math.min(0, Math.max(this.pan.minX, this.pan.x));
    this.pan.y = Math.min(0, Math.max(this.pan.minY, this.pan.y));
    this.viewport.position.set(this.pan.x, this.pan.y);
    this.handlers.layoutChanged();
    this.wake();
  }

  private get pannable(): boolean {
    return this.pan.minX < 0 || this.pan.minY < 0;
  }

  /** Scrolls a large board just enough to show `cell` with some margin. */
  private scrollIntoView(cell: number): void {
    const sprite = this.cells[cell];
    if (!sprite || !this.pannable) return;
    const margin = sprite.inradius * 3;
    const { width, height } = this.app.screen;
    const x = sprite.center.x + this.pan.x;
    const y = sprite.center.y + this.pan.y;
    if (x < margin) this.pan.x += margin - x;
    if (x > width - margin) this.pan.x -= x - (width - margin);
    if (y < margin) this.pan.y += margin - y;
    if (y > height - margin) this.pan.y -= y - (height - margin);
    this.applyPan();
  }

  /**
   * Zooms the cells: `in` and `out` step, `fit` returns to the window size, and
   * `max` goes to the largest cells. Keeps the middle of the view in place.
   */
  setZoom(step: "in" | "out" | "fit" | "max"): void {
    const next = {
      in: this.zoom * ZOOM_STEP,
      out: this.zoom / ZOOM_STEP,
      fit: 1,
      max: this.maxZoom,
    }[step];
    const zoom = Math.min(this.maxZoom, Math.max(1, next));
    if (zoom === this.zoom || !this.snapshot) return;
    const { width, height } = this.app.screen;
    const ratio = zoom / this.zoom;
    const center = { x: width / 2 - this.pan.x, y: height / 2 - this.pan.y };
    this.zoom = zoom;
    this.rebuild();
    this.pan.x = width / 2 - center.x * ratio;
    this.pan.y = height / 2 - center.y * ratio;
    this.applyPan();
  }

  private onStagePointerDown(e: FederatedPointerEvent): void {
    this.handlers.pointerPress(this.pressTarget);
    this.pressTarget = null;
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.trackWindow();
      if (this.touches.size === 2) {
        // A second finger means a pinch, not a press.
        this.cancelHold();
        this.releasePress();
        this.pinchDistance = this.fingerSpread();
      }
      return;
    }
    if (e.button === 2 && (this.locked || e.target === this.app.stage)) {
      this.handlers.fieldSecondary();
      return;
    }
    this.startDrag(e);
  }

  /**
   * Shift and the wheel scroll a board larger than the window. Every other
   * wheel goes on to resize the window, in `windowZoom`.
   */
  private onWheel(event: WheelEvent): void {
    if (!event.shiftKey || event.ctrlKey || !this.pannable) return;
    event.preventDefault();
    let dx = event.deltaX;
    let dy = event.deltaY;
    // A wheel that turns along an axis that fits scrolls the other one.
    if (this.pan.minY === 0) [dx, dy] = [dx + dy, 0];
    else if (this.pan.minX === 0) [dx, dy] = [0, dx + dy];
    this.pan.x -= dx;
    this.pan.y -= dy;
    this.applyPan();
  }

  /** Middle-button drag scrolls a board that doesn't fit. */
  private startDrag(e: FederatedPointerEvent): void {
    if (e.button !== 1 || !this.pannable) return;
    this.drag = { x: e.global.x, y: e.global.y, panX: this.pan.x, panY: this.pan.y };
    this.host.style.cursor = "grabbing";
    this.trackWindow();
    this.wake();
  }

  /** Aims the fluid's magnet at a mouse or pen over the board. */
  private onStagePointerMove(e: FederatedPointerEvent): void {
    if (!this.ferro || e.pointerType === "touch") return;
    this.pointerAt = { x: e.global.x, y: e.global.y };
    this.aimMagnet();
  }

  /** Listens on the window only while a drag or a touch needs moves off the canvas. */
  private trackWindow(): void {
    if (this.drag || this.touches.size > 0) {
      window.addEventListener("pointermove", this.onWindowPointerMove, true);
    } else {
      window.removeEventListener("pointermove", this.onWindowPointerMove, true);
    }
  }

  /** Follows a drag or a touch anywhere on the window, in the stage's coordinates. */
  private readonly onWindowPointerMove = (e: PointerEvent) => {
    const at = { x: 0, y: 0 };
    this.app.renderer.events.mapPositionToPoint(at, e.clientX, e.clientY);
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) this.moveTouch(e.pointerId, at);
    if (!this.drag) return;
    this.pan.x = this.drag.panX + (at.x - this.drag.x);
    this.pan.y = this.drag.panY + (at.y - this.drag.y);
    this.applyPan();
  };

  private moveTouch(pointerId: number, at: Point): void {
    this.touches.set(pointerId, at);
    if (this.hold && Math.hypot(at.x - this.hold.x, at.y - this.hold.y) > TOUCH_SLOP) {
      this.cancelHold();
      this.releasePress();
    }
    if (this.touches.size !== 2 || this.pinchDistance === 0) return;
    const ratio = this.fingerSpread() / this.pinchDistance;
    if (ratio >= PINCH_STEP || ratio <= 1 / PINCH_STEP) {
      this.setZoom(ratio > 1 ? "in" : "out");
      this.pinchDistance = this.fingerSpread();
    }
  }

  private fingerSpread(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private startHold(id: number, e: FederatedPointerEvent): void {
    this.cancelHold();
    this.hold = {
      x: e.global.x,
      y: e.global.y,
      timer: setTimeout(() => {
        this.hold = null;
        this.heldToFlag = true;
        this.releasePress();
        this.handlers.secondary(id);
      }, LONG_PRESS_MS),
    };
  }

  private cancelHold(): void {
    if (this.hold) clearTimeout(this.hold.timer);
    this.hold = null;
  }

  /** The system took a pointer back, for example for a scroll or edge gesture. */
  private cancelPointer(e: PointerEvent): void {
    this.cancelHold();
    this.endPointer(e);
  }

  private readonly onWindowBlur = () => {
    this.touches.clear();
    this.pinchDistance = 0;
    this.cancelHold();
    this.endPointer();
  };

  private endPointer(e?: Pick<PointerEvent, "pointerType" | "pointerId">): void {
    if (e?.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinchDistance = 0;
    }
    if (this.drag) {
      this.drag = null;
      this.host.style.cursor = "";
    }
    this.trackWindow();
    this.releasePress();
  }

  private onPointerDown(id: number, e: FederatedPointerEvent): void {
    this.pressTarget = id;
    if (this.locked) return;
    if (e.button === 2) {
      this.handlers.secondary(id);
      return;
    }
    if (e.button !== 0) return;
    this.heldToFlag = false;
    this.press(id);
    if (e.pointerType === "touch" && this.touches.size === 0) this.startHold(id, e);
  }

  private onPointerUp(id: number, e: FederatedPointerEvent): void {
    this.cancelHold();
    if (this.heldToFlag) {
      this.heldToFlag = false;
      return;
    }
    if (this.locked || e.button !== 0) return;
    const pressed = this.pressedCell;
    this.releasePress();
    if (pressed === id) this.handlers.primary(id);
  }

  private onPointerOver(id: number, e: FederatedPointerEvent): void {
    this.setHovered(id, true);
    this.pointerCell = id;
    this.inspect(id);
    // Dragging with the left button held moves the press, as in classic minesweeper.
    if (!this.locked && this.pressedCell !== null && (e.buttons & 1) === 1) this.press(id);
  }

  private onPointerOut(id: number): void {
    this.setHovered(id, false);
    if (this.pointerCell !== id) return;
    this.pointerCell = null;
    this.inspect(this.focus?.cell ?? null);
  }

  private press(id: number): void {
    this.releasePress();
    this.pressedCell = id;
    const view = this.views[id];
    if (view?.kind === "closed" && view.mark !== "flag") {
      this.preview = [id];
    } else if (view?.kind === "open" && view.adjacent > 0) {
      // Show which neighbors a smart click would touch.
      this.preview = (this.snapshot?.cells[id]?.neighbors ?? []).filter((n) => {
        const v = this.views[n];
        return v?.kind === "closed" && v.mark !== "flag";
      });
    }
    for (const n of this.preview) this.setPressed(n, true);
  }

  private releasePress(): void {
    for (const n of this.preview) this.setPressed(n, false);
    this.preview = [];
    this.pressedCell = null;
  }

  private setPressed(id: number, pressed: boolean): void {
    const cell = this.cells[id];
    if (!cell || cell.pressed === pressed) return;
    cell.pressed = pressed;
    this.drawShape(cell);
    this.wake();
  }

  private setHovered(id: number, hovered: boolean): void {
    const cell = this.cells[id];
    if (!cell || cell.hovered === hovered) return;
    cell.hovered = hovered;
    if (cell.view.kind === "closed") {
      this.drawShape(cell);
      if (hovered && !this.locked) this.startGlint(cell);
      this.wake();
    }
  }

  /** Sweeps a band of the glare's color once across a closed cell, unless motion is reduced. */
  private startGlint(cell: CellSprite): void {
    this.clearGlint();
    if (!this.motion || this.theme.glintAlpha <= 0) return;
    const band = new Graphics();
    band.position.copyFrom(cell.center);
    this.overlayLayer.addChild(band);
    this.glint = { cell: cell.id, band, shownAt: this.clock };
  }

  private clearGlint(): void {
    this.glint?.band.destroy();
    this.glint = null;
  }

  /**
   * Draws the glint as far as its sweep has come. Ends it after one sweep, or
   * once its cell opens or is pressed, and says whether it still runs.
   */
  private moveGlint(): boolean {
    const glint = this.glint;
    const cell = glint ? this.cells[glint.cell] : undefined;
    const shape = cell && this.shapes.get(cell.shapeKey);
    const p = glint ? (this.clock - glint.shownAt) / GLINT_MS : 1;
    if (!glint || !cell || !shape || p >= 1 || cell.view.kind !== "closed" || cell.pressed) {
      this.clearGlint();
      return false;
    }
    const light = toward(this.theme.lightAngle);
    const side = across(light);
    const axis = {
      x: side.x + light.x * GLINT.slant,
      y: side.y + light.y * GLINT.slant,
    };
    const length = Math.hypot(axis.x, axis.y);
    const unit = { x: axis.x / length, y: axis.y / length };
    const back = { x: -unit.x, y: -unit.y };
    const width = cell.inradius * GLINT.width;
    const [lo, hi] = extent(shape.sheen, unit);
    const at = lo - width + (hi - lo + width) * ease.outCubic(p);
    const reach = 4 * cell.inradius;
    const band = intersectConvex(
      intersectConvex(shape.sheen, halfPlane(unit, at, reach)),
      halfPlane(back, -(at + width), reach),
    );
    glint.band.clear();
    if (band.length >= 3) {
      glint.band
        .poly(band.flatMap((q) => [q.x, q.y]))
        .fill({ color: this.theme.gloss, alpha: this.theme.glintAlpha * Math.sin(Math.PI * p) });
    }
    return true;
  }
}
