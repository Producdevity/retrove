import {
  drawableRenderer,
  FULL_DISPLAY,
  type DrawableRenderer,
} from "../../../../web/drawable.mjs";
import { glesImports } from "../../../../web/gles.mjs";
import { Gauge, gauges } from "../../diagnostics/gauges";
import { WorkerControl } from "../../cpu/worker/channel";
import { GRAPHICS_CONTEXT_ATTRIBUTES, graphicsContextInfo } from "../context-info";
import { isAllocateCommand, isPresentCommand } from "./drawable-commands";
import {
  CallKind,
  GraphicsChannel,
  GraphicsStatistic,
  HeapOperation,
  type GraphicsStatistic as Statistic,
} from "./graphics-channel";
import { GraphicsServer, type CallingThread } from "./graphics-server";
import { GuestView } from "./guest-view";
import { GraphicsMessage, type FromGraphics, type GraphicsStart } from "./protocol";

type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;
/** Local GL calls between refreshes of the GPU memory gauges the main thread reports. */
const GAUGE_INTERVAL = 4096;
const GAUGES: readonly (readonly [Gauge, Statistic])[] = [
  [Gauge.GpuTextureBytes, GraphicsStatistic.TextureBytes],
  [Gauge.GpuBufferBytes, GraphicsStatistic.BufferBytes],
  [Gauge.GpuRenderbufferBytes, GraphicsStatistic.RenderbufferBytes],
];
const encoder = new TextEncoder();

/** What an execution thread needs from the GL owner on its worker. */
export interface WorkerGraphics {
  has(pc: number): boolean;
  local(pc: number, thread: CallingThread): number | Promise<number>;
  serve(): boolean;
  /** True once after a present: the worker should reach its event loop so the frame shows. */
  takeFrame(): boolean;
  readonly asynchronous: boolean;
}

function createContext(canvas: OffscreenCanvas): GraphicsContext {
  const context =
    canvas.getContext("webgl2", GRAPHICS_CONTEXT_ATTRIBUTES) ??
    canvas.getContext("webgl", GRAPHICS_CONTEXT_ATTRIBUTES);
  if (
    !(context instanceof WebGLRenderingContext) &&
    !(typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext)
  )
    throw new Error("WebGL is unavailable in the graphics worker.");
  return context;
}

/**
 * The WebGL context on an execution worker, behind gles.mjs over the worker's view of guest
 * memory. The main thread forwards its GL calls and drawable commands; this worker's own guest
 * thread calls GL directly.
 */
export class GraphicsOwner implements WorkerGraphics {
  readonly server: GraphicsServer;
  readonly #channel: GraphicsChannel;
  readonly #renderer: DrawableRenderer;
  #frame = false;
  #calls = 0;
  constructor(start: GraphicsStart, post: (message: FromGraphics) => void) {
    const channel = new GraphicsChannel(start.channel),
      control = new WorkerControl(start.control),
      view = new GuestView(start.memory, start.arena, start.mask),
      context = createContext(start.canvas);
    this.#channel = channel;
    start.canvas.addEventListener("webglcontextlost", () => post({ type: GraphicsMessage.Lost }));
    const diagnostic = (level: string, area: string, message: string, details?: unknown) =>
      post({ type: GraphicsMessage.Diagnostic, level, area, message, details });
    diagnostic("info", "graphics", "Graphics context created", {
      ...graphicsContextInfo(context),
      worker: true,
    });
    const ring = () => control.ring(),
      alloc = (size: number) => channel.heap(HeapOperation.Allocate, size, ring);
    const heap = {
      alloc,
      free: (address: number) => void channel.heap(HeapOperation.Free, address, ring),
      string: (text: string) => {
        const bytes = encoder.encode(text + "\0"),
          address = alloc(bytes.length);
        if (address) view.write(address, bytes);
        return address;
      },
    };
    const api = glesImports(view, heap, () => context, diagnostic, {
      currentAPI: () => this.server.api,
      currentContext: () => this.server.context,
      errorFlag: start.errorFlag,
      bindingShadow: start.bindingShadow,
    });
    this.#renderer = drawableRenderer(() => context);
    this.server = new GraphicsServer(channel, view, Object.keys(api), api, (kind, payload) =>
      this.#command(kind, payload),
    );
  }
  #publish(): void {
    for (const [gauge, statistic] of GAUGES) this.#channel.set(statistic, gauges.value(gauge));
  }
  #command(kind: CallKind, payload: unknown): number {
    if (kind === CallKind.Allocate) {
      if (!isAllocateCommand(payload)) throw new Error("Invalid drawable allocation.");
      const { target, drawable, colorFormat, size } = payload;
      return this.#renderer.allocate(target, drawable, colorFormat, size) ? 1 : 0;
    }
    if (!isPresentCommand(payload)) throw new Error("Invalid drawable presentation.");
    const placements = new Map(payload.placements),
      presented = this.#renderer.present(
        payload.target,
        (drawable) => placements.get(drawable) ?? FULL_DISPLAY,
      );
    this.#channel.add(GraphicsStatistic.Presents, 1);
    this.#publish();
    this.#frame = true;
    return presented;
  }
  has(pc: number): boolean {
    return this.server.has(pc);
  }
  local(pc: number, thread: CallingThread): number | Promise<number> {
    if (++this.#calls % GAUGE_INTERVAL === 0) this.#publish();
    return this.server.local(pc, thread);
  }
  serve(): boolean {
    return this.server.serve();
  }
  takeFrame(): boolean {
    const frame = this.#frame;
    this.#frame = false;
    return frame;
  }
  get asynchronous(): boolean {
    return this.server.asynchronous;
  }
}
