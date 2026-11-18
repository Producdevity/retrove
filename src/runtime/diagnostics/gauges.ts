/** Live runtime measurements, cheap enough to read several times a second. */
export const Gauge = {
  PresentedFrames: "presentedFrames",
  GuestCpuMs: "guestCpuMs",
  GuestMappedBytes: "guestMappedBytes",
  GuestMappedPeak: "guestMappedPeak",
  WasmMemoryBytes: "wasmMemoryBytes",
  TranslatedCodeBytes: "translatedCodeBytes",
  TranslatedFunctions: "translatedFunctions",
  CodeFlushes: "codeFlushes",
  GpuTextureBytes: "gpuTextureBytes",
  GpuBufferBytes: "gpuBufferBytes",
  GpuRenderbufferBytes: "gpuRenderbufferBytes",
  FileCacheBytes: "fileCacheBytes",
  GuestThreads: "guestThreads",
} as const;
export type Gauge = (typeof Gauge)[keyof typeof Gauge];

/**
 * Counters kept by the code that owns each resource, or read on demand. Safari exposes no
 * memory API, so the memory gauges are Retrove's own accounting of what it allocated.
 */
export class Gauges {
  readonly #values = new Map<Gauge, number>();
  readonly #readers = new Map<Gauge, () => number>();
  add(gauge: Gauge, delta: number): void {
    this.#values.set(gauge, (this.#values.get(gauge) ?? 0) + delta);
  }
  set(gauge: Gauge, value: number): void {
    this.#values.set(gauge, value);
  }
  /** Reads `gauge` from `reader` whenever it is asked for. */
  read(gauge: Gauge, reader: () => number): void {
    this.#readers.set(gauge, reader);
  }
  value(gauge: Gauge): number {
    const reader = this.#readers.get(gauge);
    if (!reader) return this.#values.get(gauge) ?? 0;
    try {
      const value = reader();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
}

/** One player page runs one app, so the gauges are shared by its runtime and its overlay. */
export const gauges = new Gauges();
