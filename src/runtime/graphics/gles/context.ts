import type { DiagnosticSink } from "../../ios/libc/files/types";
import { Gauge } from "../../diagnostics/gauges";
import { write32, type GuestMemory } from "../../memory/guest-memory";
import { GLErrorState } from "../driver-errors";
import { RenderingAPI, type GraphicsCall } from "../fixed-function/host";
import type { GraphicsContext } from "../gl-parameters";
import { GpuMemory, TEXEL_BYTES, textureBinding, texturePart } from "../gpu-memory";
import { BINDING_SHADOW_BYTES, BindingShadow } from "../guest-bindings";
import { DEFAULT_ALIGNMENT, Gles } from "./constants";
import { anyObjectParameter } from "../gl-parameters";
import { GlesHandles } from "./handles";

export type GlesFunction = GraphicsCall;
export interface GlesHeap {
  alloc(size: number): number;
  free(address: number): void;
  string(text: string): number;
  zero?(size: number): number;
}
export interface GlesOptions {
  readonly currentAPI?: () => number;
  readonly currentContext?: () => number;
  readonly onClose?: (close: () => void) => void;
  readonly onErrorFlag?: (address: number) => void;
  readonly onBindingShadow?: (address: number) => void;
  /** Guest word the guest's glGetError fast path reads; allocated by the caller. */
  readonly errorFlag?: number;
  /** Guest words the guest's bind fast paths read; allocated by the caller. */
  readonly bindingShadow?: number;
}
/** The host copy of a buffer's data and the guest block MapBufferOES hands out for it. */
export interface BufferBacking {
  readonly size: number;
  bytes: Uint8Array | null;
  block: { readonly pointer: number; current: boolean } | undefined;
}

const DRIVER_CHECK_DUE = 1;

/** State the OpenGL ES entry points share: the context, object names, buffers and error flags. */
export class GlesContext {
  readonly api: Record<string, GlesFunction> = {};
  readonly handles = new GlesHandles();
  readonly errors = new GLErrorState();
  readonly memory = {
    Texture: new GpuMemory(Gauge.GpuTextureBytes),
    Buffer: new GpuMemory(Gauge.GpuBufferBytes),
    Renderbuffer: new GpuMemory(Gauge.GpuRenderbufferBytes),
  };
  readonly bufferData = new Map<number, BufferBacking>();
  readonly mapped = new Map<number, number>();
  readonly shadow: BindingShadow | undefined;
  readonly currentAPI: () => number;
  readonly currentContext: () => number;
  array = 0;
  elements = 0;
  packAlign: number = DEFAULT_ALIGNMENT;
  unpackAlign: number = DEFAULT_ALIGNMENT;
  readonly #errorFlag: number;
  #context: GraphicsContext | undefined;

  constructor(
    readonly cpu: GuestMemory,
    readonly heap: GlesHeap,
    private readonly getContext: () => GraphicsContext | null,
    readonly diagnostic: DiagnosticSink | undefined,
    options: GlesOptions,
  ) {
    this.currentAPI = options.currentAPI ?? (() => RenderingAPI.OpenGLES2);
    this.currentContext = options.currentContext ?? (() => 0);
    // Nonzero while glGetError must ask the host: an error is pending or a driver check is due.
    this.#errorFlag = options.errorFlag ?? heap.zero?.(Int32Array.BYTES_PER_ELEMENT) ?? 0;
    if (this.#errorFlag) {
      this.flagErrors(DRIVER_CHECK_DUE);
      options.onErrorFlag?.(this.#errorFlag);
    }
    const shadowAddress = options.bindingShadow ?? heap.zero?.(BINDING_SHADOW_BYTES) ?? 0;
    this.shadow = shadowAddress
      ? new BindingShadow(shadowAddress, (pointer, value) => write32(cpu, pointer, value))
      : undefined;
    if (this.shadow) options.onBindingShadow?.(shadowAddress);
  }

  gl(): GraphicsContext {
    this.#context ??= this.getContext() ?? undefined;
    if (!this.#context) throw new Error("WebGL 1 context is unavailable");
    if (this.#context.isContextLost()) throw new Error("WebGL context lost");
    return this.#context;
  }
  bind(name: string, implementation: GlesFunction): void {
    this.api["_gl" + name] = implementation;
  }
  flagErrors(value: number): void {
    if (this.#errorFlag) write32(this.cpu, this.#errorFlag, value);
  }
  setError(code: number): void {
    this.errors.record(code);
    this.flagErrors(DRIVER_CHECK_DUE);
  }
  flagDriverCheck(): void {
    if (this.errors.driverDue(performance.now())) this.flagErrors(DRIVER_CHECK_DUE);
  }
  /** Fixed-function state follows each EAGL context, so only OpenGL ES 2 bindings may be skipped. */
  shadowed(update: (shadow: BindingShadow) => void): void {
    if (!this.shadow) return;
    if (this.currentAPI() === RenderingAPI.OpenGLES2) update(this.shadow);
    else this.shadow.forget();
  }
  /** Accounting only: a context without the query records nothing rather than failing the call. */
  bound(binding: number): number {
    return typeof this.gl().getParameter === "function"
      ? this.handles.any(anyObjectParameter(this.gl(), binding))
      : 0;
  }
  textureLevel(target: number, level: number, bytes: number): void {
    this.memory.Texture.set(this.bound(textureBinding(target)), texturePart(target, level), bytes);
  }
  renderbufferStorage(width: number, height: number, samples = 1): void {
    this.memory.Renderbuffer.set(
      this.bound(Gles.RenderbufferBinding),
      0,
      width * height * samples * TEXEL_BYTES,
    );
  }
  releaseMapping(backing: BufferBacking | undefined): undefined {
    if (backing?.block) this.heap.free(backing.block.pointer);
    return undefined;
  }
  boundBuffer(target: number): number {
    if (target === Gles.ArrayBuffer) return this.array;
    return target === Gles.ElementArrayBuffer ? this.elements : 0;
  }
}
