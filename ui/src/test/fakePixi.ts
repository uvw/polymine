/**
 * Minimal stand-ins for the Pixi classes `BoardView` uses, so its logic runs in
 * jsdom without WebGL. Drawing calls are recorded, not rendered.
 */

type Handler = (event: unknown) => void;

class Point2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  set(x: number, y = x) {
    this.x = x;
    this.y = y;
  }
  copyFrom(p: { x: number; y: number }) {
    this.set(p.x, p.y);
  }
}

export class Container {
  isRenderGroup: boolean;
  children: Container[] = [];
  position = new Point2();
  scale = new Point2(1, 1);
  alpha = 1;
  visible = true;
  tint = 0xffffff;
  blendMode = "normal";
  filters: unknown[] = [];
  rotation = 0;
  eventMode = "auto";
  cursor = "";
  hitArea: unknown = null;
  destroyed = false;
  handlers = new Map<string, Handler[]>();

  constructor(options?: { isRenderGroup?: boolean }) {
    this.isRenderGroup = options?.isRenderGroup ?? false;
  }

  get x() {
    return this.position.x;
  }
  set x(v: number) {
    this.position.x = v;
  }
  get y() {
    return this.position.y;
  }
  set y(v: number) {
    this.position.y = v;
  }
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
  addChild(...children: Container[]) {
    this.children.push(...children);
    return children[0];
  }
  addChildAt(child: Container, index: number) {
    this.children.splice(index, 0, child);
    return child;
  }
  removeChildren() {
    const removed = this.children;
    this.children = [];
    return removed;
  }
  destroy() {
    this.destroyed = true;
  }
}

const drawing = [
  "roundShape",
  "fill",
  "stroke",
  "moveTo",
  "lineTo",
  "poly",
  "circle",
  "rect",
  "roundRect",
  "clear",
  "cut",
] as const;

export class GraphicsContext {
  /** How many drawings were made, shared or not. */
  static created = 0;
  calls: string[] = [];
  /** Every fill and stroke style, in order. */
  styles: unknown[] = [];
  batchMode = "auto";
  destroyed = false;
  constructor() {
    GraphicsContext.created++;
  }
  destroy() {
    this.destroyed = true;
  }
}
for (const name of drawing) {
  (GraphicsContext.prototype as unknown as Record<string, unknown>)[name] = function (
    this: GraphicsContext,
    style?: unknown,
  ) {
    this.calls.push(name);
    if (name === "fill" || name === "stroke") this.styles.push(style);
    return this;
  };
}

export class Graphics extends Container {
  context: GraphicsContext;
  constructor(options?: GraphicsContext | { context?: GraphicsContext; blendMode?: string }) {
    super();
    const fromOptions = options instanceof GraphicsContext ? { context: options } : options;
    this.context = fromOptions?.context ?? new GraphicsContext();
    this.blendMode = fromOptions?.blendMode ?? "normal";
  }
}
for (const name of drawing) {
  (Graphics.prototype as unknown as Record<string, unknown>)[name] = function (this: Graphics) {
    this.context.calls.push(name);
    return this;
  };
}

export class Text extends Container {
  text: string;
  style: Record<string, unknown>;
  constructor(options: { text: string; style: Record<string, unknown> }) {
    super();
    this.text = options.text;
    this.style = options.style;
  }
}

export class CanvasSource {
  resource: HTMLCanvasElement;
  /** Every `drawImage` call's arguments. */
  drawn: unknown[][] = [];
  /** Pixels handed to `putImageData`. */
  put: Uint8ClampedArray[] = [];
  /** Makes `getImageData` throw, as it does on a canvas the browser has tainted. */
  static tainted = false;
  /** `getImageData` reads every pixel as opaque red. */
  context2D = {
    drawImage: (...args: unknown[]) => this.drawn.push(args),
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      if (CanvasSource.tainted) throw new Error("tainted");
      const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
        i % 4 === 0 || i % 4 === 3 ? 255 : 0,
      );
      return { data };
    },
    putImageData: (image: { data: Uint8ClampedArray }) => this.put.push(image.data),
  };
  updated = 0;
  constructor(public options: { width: number; height: number; resolution?: number }) {
    const resolution = options.resolution ?? 1;
    this.resource = document.createElement("canvas");
    this.resource.width = Math.round(options.width * resolution);
    this.resource.height = Math.round(options.height * resolution);
  }
  update() {
    this.updated++;
  }
}

export class Texture<Source = CanvasSource> {
  destroyed = false;
  constructor(public options: { source: Source }) {}
  destroy() {
    this.destroyed = true;
  }
}

export class BufferImageSource {
  constructor(
    public options: { resource: Uint8Array; width: number; height: number; alphaMode?: string },
  ) {}
}

export class FillGradient {
  destroyed = false;
  constructor(public options: Record<string, unknown>) {}
  destroy() {
    this.destroyed = true;
  }
}

/** An affine map, `x' = a x + c y + tx` and `y' = b x + d y + ty`, as Pixi writes it. */
export class Matrix {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public tx = 0,
    public ty = 0,
  ) {}
  apply(p: { x: number; y: number }) {
    return { x: this.a * p.x + this.c * p.y + this.tx, y: this.b * p.x + this.d * p.y + this.ty };
  }
  invert() {
    const { a, b, c, d, tx, ty } = this;
    const n = a * d - b * c;
    return new Matrix(d / n, -b / n, -c / n, a / n, (c * ty - d * tx) / n, -(a * ty - b * tx) / n);
  }
}

export class Sprite extends Container {
  texture: Texture;
  anchor: number;
  constructor(options: { texture: Texture; anchor: number }) {
    super();
    this.texture = options.texture;
    this.anchor = options.anchor;
  }
}

/** A render target: its size in texels follows `resize`, as Pixi's does. */
export class RenderTexture {
  destroyed = false;
  source = { pixelWidth: 1, pixelHeight: 1, resolution: 1, format: "" };
  static create(options: { width: number; height: number; resolution?: number; format?: string }) {
    const texture = new RenderTexture();
    texture.source.format = options.format ?? "bgra8unorm";
    texture.resize(options.width, options.height, options.resolution ?? 1);
    return texture;
  }
  resize(width: number, height: number, resolution = this.source.resolution) {
    this.source.resolution = resolution;
    this.source.pixelWidth = Math.max(1, Math.round(width * resolution));
    this.source.pixelHeight = Math.max(1, Math.round(height * resolution));
  }
  destroy() {
    this.destroyed = true;
  }
}

/** A shader whose uniform groups hold their values in `uniforms`, as Pixi's do. */
export class Shader {
  destroyed = false;
  resources: Record<string, unknown> = {};
  constructor(public glProgram: { vertex: string; fragment: string; name?: string }) {}
  static from(options: {
    gl: { vertex: string; fragment: string; name?: string };
    resources: Record<string, unknown>;
  }) {
    const shader = new Shader(options.gl);
    for (const [name, resource] of Object.entries(options.resources)) {
      const group = resource as Record<string, { value?: unknown }>;
      const uniforms = Object.values(group).every(
        (u) => u && typeof u === "object" && "value" in u,
      );
      shader.resources[name] = uniforms
        ? { uniforms: Object.fromEntries(Object.entries(group).map(([k, u]) => [k, u.value])) }
        : resource;
    }
    return shader;
  }
  destroy() {
    this.destroyed = true;
  }
}

export class MeshGeometry {
  constructor(public options: Record<string, unknown>) {}
}

export class Mesh extends Container {
  geometry: MeshGeometry;
  shader: Shader;
  constructor(options: { geometry: MeshGeometry; shader: Shader }) {
    super();
    this.geometry = options.geometry;
    this.shader = options.shader;
  }
}

export class Polygon {
  constructor(public points: number[]) {}
}

export class Ticker {
  started = true;
  maxFPS = 0;
  listeners: ((ticker: { deltaMS: number }) => void)[] = [];
  add(fn: (ticker: { deltaMS: number }) => void) {
    this.listeners.push(fn);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
  }
  /** Advances one frame of `ms`, but only while started, like the real ticker. */
  step(ms = 16) {
    if (!this.started) return false;
    for (const fn of this.listeners) fn({ deltaMS: ms });
    return true;
  }
}

export class Application {
  static last: Application | null = null;
  canvas = document.createElement("canvas");
  stage = new Container();
  ticker = new Ticker();
  screen = { width: 0, height: 0 };
  renderer = {
    resolution: 1,
    /** Every offscreen render, with what it drew and where. */
    renders: [] as { container: unknown; target: unknown }[],
    resize(_width: number, _height: number, resolution?: number) {
      if (resolution !== undefined) this.resolution = resolution;
    },
    render(options: { container: unknown; target: unknown }) {
      this.renders.push(options);
    },
  };
  destroyed = false;
  async init(options: { resizeTo: HTMLElement; resolution?: number }) {
    this.screen = { width: options.resizeTo.clientWidth, height: options.resizeTo.clientHeight };
    this.renderer.resolution = options.resolution ?? 1;
    Application.last = this;
  }
  destroy() {
    this.destroyed = true;
  }
}

/** A federated pointer event with the fields `BoardView` reads. */
export function pointer(button = 0, buttons = 0, global = { x: 0, y: 0 }, target?: unknown) {
  return { button, buttons, global, target, pointerType: "mouse", pointerId: 1 };
}

/** A touch with the given pointer id, as `pointer` gives a mouse event. */
export function touch(pointerId: number, global = { x: 0, y: 0 }, target?: unknown) {
  return { button: 0, buttons: 1, global, target, pointerType: "touch", pointerId };
}
