import type { OffscreenDisplay } from "../../../player/display";
import { Gauge, gauges } from "../../diagnostics/gauges";
import type { WorkerThreads } from "../../cpu/worker/worker-host";
import { Placement, type ThreadRule } from "../../cpu/worker/placement";
import type { Heap } from "../../memory/guest-memory";
import { BINDING_SHADOW_BYTES } from "../guest-bindings";
import { CallKind, GraphicsStatistic, ARGUMENT_REGISTERS } from "./graphics-channel";
import type { GraphicsLink } from "./graphics-link";

const ERROR_FLAG_BYTES = 4;
const SP = 13;
const DrawableCommand = { allocate: CallKind.Allocate, present: CallKind.Present } as const;

export interface RemoteGraphicsOptions {
  readonly workers: WorkerThreads | undefined;
  /** The app profile's thread rules; the context moves only when one places a graphics thread. */
  readonly rules: readonly ThreadRule[] | undefined;
  readonly display: (() => OffscreenDisplay) | undefined;
  readonly heap: Heap;
  idle<T>(promise: Promise<T>): Promise<T>;
  diagnostic(level: string, area: string, message: string, details?: unknown): void;
}
interface Registers {
  getReg(index: number): number;
}
type ForwardedFunction = () => number | undefined | Promise<number | undefined>;

/** Whether this page can hand its canvas to a worker that creates WebGL there. */
function offscreenSupported(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype
  );
}

/**
 * The guest's OpenGL ES imports when the WebGL context lives on the worker that runs the app's
 * graphics thread: main-thread callers forward each call, and the drawable's commands go there.
 */
export class RemoteGraphics {
  readonly #names = new Map<unknown, string>();
  constructor(
    readonly link: GraphicsLink,
    readonly canvas: HTMLCanvasElement,
    readonly errorFlag: number,
    readonly bindingShadow: number,
  ) {
    for (const [gauge, statistic] of [
      [Gauge.GpuTextureBytes, GraphicsStatistic.TextureBytes],
      [Gauge.GpuBufferBytes, GraphicsStatistic.BufferBytes],
      [Gauge.GpuRenderbufferBytes, GraphicsStatistic.RenderbufferBytes],
    ] as const)
      gauges.read(gauge, () => link.channel.statistic(statistic));
  }
  /** Forwarders for every GL import, reading the caller's registers from `cpu`. */
  imports(
    cpu: Registers,
    state: () => readonly [number, number],
  ): Record<string, ForwardedFunction> {
    const imports: Record<string, ForwardedFunction> = {};
    this.link.names.forEach((name, index) => {
      const forward: ForwardedFunction = () => {
        const [api, context] = state();
        return this.link.call(index, {
          registers: Array.from({ length: ARGUMENT_REGISTERS }, (_, register) =>
            cpu.getReg(register),
          ),
          sp: cpu.getReg(SP),
          api,
          context,
        });
      };
      this.#names.set(forward, name);
      imports[name] = forward;
    });
    return imports;
  }
  /** Sends the owner the gates bound to GL imports, so its own thread calls them in place. */
  publishGates(stubs: ReadonlyMap<number, { readonly fn?: unknown }>): void {
    const gates: (readonly [number, string])[] = [];
    for (const [pc, stub] of stubs) {
      const name = this.#names.get(stub.fn);
      if (name) gates.push([pc, name]);
    }
    this.link.setGates(gates);
  }
  /** Runs an EAGL drawable command ("allocate" or "present") where the context lives. */
  command = (kind: string, payload: unknown): number => {
    if (kind !== "allocate" && kind !== "present")
      throw new Error(`Unknown drawable command ${kind}.`);
    return this.link.command(DrawableCommand[kind], payload);
  };
  /** Draw and clear calls the owner's own thread made. */
  get localRender(): { readonly drawCalls: number; readonly clearCalls: number } {
    return {
      drawCalls: this.link.channel.statistic(GraphicsStatistic.DrawCalls),
      clearCalls: this.link.channel.statistic(GraphicsStatistic.ClearCalls),
    };
  }
  get localMs(): number {
    return this.link.channel.statistic(GraphicsStatistic.LocalMs);
  }
}

/** Moves the WebGL context to a graphics worker when worker threads and the app profile ask for it. */
export async function startRemoteGraphics(
  options: RemoteGraphicsOptions,
): Promise<RemoteGraphics | undefined> {
  const { workers, rules, display, heap } = options;
  if (!workers || !display || !offscreenSupported()) return undefined;
  if (!rules?.some((rule) => rule.placement === Placement.Graphics)) return undefined;
  const errorFlag = heap.zero(ERROR_FLAG_BYTES),
    bindingShadow = heap.zero(BINDING_SHADOW_BYTES),
    screen = display();
  const link = await workers.startGraphics({
    canvas: screen.offscreen,
    lost: () => screen.lost(),
    errorFlag,
    bindingShadow,
    heap,
    idle: (promise) => options.idle(promise),
    diagnostic: (level, area, message, details) =>
      options.diagnostic(level, area, message, details),
  });
  return new RemoteGraphics(link, screen.canvas, errorFlag, bindingShadow);
}
