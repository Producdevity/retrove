import { floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import type { GuestMemory } from "../../memory/guest-memory";
import type { BitmapContext, RasterContext } from "./bitmap-context";
import { Colors } from "./colors/model";
import type { ImageMetadata } from "./image-metadata";

const HANDLE_BYTES = 4;
const RGB_CHANNELS = 3;
const COLOR_MAXIMUM = 255;
const ALPHA_CHANNEL = 3;

export type Bounds = [number, number, number, number];
export interface QuartzHeap {
  zero(size: number): number;
  free(pointer: number): void;
}
export interface CoreGraphicsObjc {
  currentThreadId?(): number;
  readonly funcs: {
    _CFDataGetBytePtr(args: GuestArguments): number;
    _CFDataGetLength(args: GuestArguments): number;
  };
  retainObject(pointer: number): unknown;
  releaseObject(pointer: number): unknown;
  stringText(pointer: number): string;
}
/** Reference-counted tables the object table consults before its own entries. */
export interface HandleTable {
  has(pointer: number): boolean;
  retain(pointer: number): number;
  release(pointer: number): void;
  refs(pointer: number): number | undefined;
}
export interface ContextObject {
  readonly kind: "context";
  refs: number;
  canvas: RasterContext;
  saves: number;
  antialias: boolean;
  bounds: Bounds | null;
  bitmap?: BitmapContext;
}
export interface SpaceObject {
  readonly kind: "space";
  refs: number;
  components: number;
}
export interface ProviderObject {
  readonly kind: "provider";
  refs: number;
  data: number;
}
/** Where a provider-backed image's pixels come from until they are decoded. */
export interface ImageSource {
  readonly provider: number;
  readonly components: number;
  readonly decode: number[] | undefined;
  readonly little: boolean;
}
export interface ImageObject extends ImageMetadata {
  readonly kind: "image";
  refs: number;
  source?: ImageSource;
  rgba?: Uint8ClampedArray;
}
export type QuartzObject = ContextObject | SpaceObject | ProviderObject | ImageObject;
type Without<T> = T extends unknown ? Omit<T, "refs"> : never;
export type NewObject = Without<QuartzObject>;

export function floatWords(args: GuestArguments, first: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => floatFromBits(args(first + index)));
}

/** Quartz objects live independently of Objective-C objects and retain their backing storage. */
export class QuartzObjects {
  readonly objects = new Map<number, QuartzObject>();
  readonly stacks = new Map<number, number[]>();
  readonly tables: HandleTable[] = [];
  readonly colors: Colors;
  forgetContext: (pointer: number) => void = () => {};

  constructor(
    readonly cpu: GuestMemory,
    readonly heap: QuartzHeap,
    readonly objc: CoreGraphicsObjc,
  ) {
    this.colors = new Colors({
      allocate: (size) => heap.zero(size),
      free: (pointer) => heap.free(pointer),
      read: (pointer, size) => cpu.read(pointer, size),
      write: (pointer, bytes) => cpu.write(pointer, bytes),
      spaceComponents: (pointer) => this.space(pointer)?.components,
      createSpace: (components) => this.add({ kind: "space", components }),
      retainSpace: (pointer) => this.retain(pointer),
      releaseSpace: (pointer) => this.release(pointer),
    });
  }

  thread(): number {
    return this.objc.currentThreadId?.() ?? 0;
  }
  add(object: NewObject): number {
    const pointer = this.heap.zero(HANDLE_BYTES);
    if (pointer) this.objects.set(pointer, { ...object, refs: 1 });
    return pointer;
  }
  context(pointer: number): ContextObject | undefined {
    const object = this.objects.get(pointer);
    return object?.kind === "context" ? object : undefined;
  }
  space(pointer: number): SpaceObject | undefined {
    const object = this.objects.get(pointer);
    return object?.kind === "space" ? object : undefined;
  }
  provider(pointer: number): ProviderObject | undefined {
    const object = this.objects.get(pointer);
    return object?.kind === "provider" ? object : undefined;
  }
  image(pointer: number): ImageObject | undefined {
    const object = this.objects.get(pointer);
    return object?.kind === "image" ? object : undefined;
  }
  canvas(pointer: number): RasterContext | null {
    return this.context(pointer)?.canvas ?? null;
  }
  table(pointer: number): HandleTable | undefined {
    return this.tables.find((table) => table.has(pointer));
  }
  floats(pointer: number, count: number): number[] {
    const view = new DataView(this.cpu.read(pointer, count * WORD_BYTES).slice().buffer);
    return Array.from({ length: count }, (_, index) => view.getFloat32(index * WORD_BYTES, true));
  }
  /** Bytes behind a CFData-backed provider. */
  providerBytes(pointer: number): Uint8Array | undefined {
    const provider = this.provider(pointer);
    if (!provider) return undefined;
    const { funcs } = this.objc;
    return this.cpu
      .read(
        funcs._CFDataGetBytePtr(() => provider.data),
        funcs._CFDataGetLength(() => provider.data),
      )
      .slice();
  }

  retain(pointer: number): number {
    if (this.colors.has(pointer)) return this.colors.retain(pointer);
    const table = this.table(pointer);
    if (table) return table.retain(pointer);
    const object = this.objects.get(pointer);
    if (object) object.refs++;
    return object ? pointer : 0;
  }
  async release(pointer: number): Promise<void> {
    if (this.colors.has(pointer)) return this.colors.release(pointer);
    const table = this.table(pointer);
    if (table) return table.release(pointer);
    const object = this.objects.get(pointer);
    if (!object || --object.refs) return;
    this.objects.delete(pointer);
    this.heap.free(pointer);
    if (object.kind === "context") {
      this.forgetContext(pointer);
      if (object.bitmap) {
        object.bitmap.close();
        await this.release(object.bitmap.space);
      }
    }
    if (object.kind === "provider") await this.objc.releaseObject(object.data);
    if (object.kind === "image") {
      if (object.source) await this.release(object.source.provider);
      await this.release(object.space);
    }
  }
  retainCount(pointer: number): number | undefined {
    return (
      this.colors.get(pointer)?.refs ??
      this.table(pointer)?.refs(pointer) ??
      this.objects.get(pointer)?.refs
    );
  }
  owns(pointer: number): boolean {
    return this.colors.has(pointer) || this.objects.has(pointer) || Boolean(this.table(pointer));
  }

  current(): number {
    return this.stacks.get(this.thread())?.at(-1) ?? 0;
  }
  push(pointer: number): void {
    const id = this.thread();
    const stack = this.stacks.get(id) ?? [];
    this.stacks.set(id, stack);
    stack.push(pointer);
  }
  pop(): void {
    const id = this.thread();
    const stack = this.stacks.get(id);
    if (!stack) return;
    stack.pop();
    if (!stack.length) this.stacks.delete(id);
  }
  async withContext<T>(canvas: RasterContext, callback: () => Promise<T> | T): Promise<T> {
    const id = this.thread();
    const stack = this.stacks.get(id) ?? [];
    const pointer = this.add({
      kind: "context",
      canvas,
      saves: 0,
      antialias: true,
      bounds: null,
    });
    if (!pointer) throw Error("Unable to allocate a Quartz drawing context");
    this.stacks.set(id, stack);
    stack.push(pointer);
    canvas.save();
    try {
      return await callback();
    } finally {
      for (let index = this.context(pointer)?.saves ?? 0; index >= 0; index--) canvas.restore();
      stack.pop();
      if (!stack.length) this.stacks.delete(id);
      await this.release(pointer);
    }
  }
  /** Bitmap contexts mirror guest memory, so drawing into one must load and store its pixels. */
  paint(pointer: number, draw: (canvas: RasterContext) => void): boolean {
    const object = this.context(pointer);
    if (!object) return false;
    object.bitmap?.refresh();
    try {
      draw(object.canvas);
    } finally {
      object.bitmap?.commit();
    }
    return true;
  }
  drawCurrent(draw: (canvas: RasterContext) => void): boolean {
    return this.paint(this.current(), draw);
  }
  setColor(channels: readonly number[], fill: boolean, stroke: boolean): void {
    const canvas = this.canvas(this.current());
    if (!canvas) return;
    const rgb = channels
      .slice(0, RGB_CHANNELS)
      .map((value) => Math.round(value * COLOR_MAXIMUM))
      .join(",");
    const color = `rgba(${rgb},${channels[ALPHA_CHANNEL] ?? 1})`;
    if (fill) canvas.fillStyle = color;
    if (stroke) canvas.strokeStyle = color;
  }
}
