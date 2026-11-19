import type { TierModule } from "../translation/tier-options";

const WASM_PAGE_BYTES = 65_536;

/** Shared memory needs a cross-origin isolated page; Workers then run guest threads on the same bytes. */
export function crossOriginIsolation(): boolean {
  return globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined";
}

/** Pages for the arena plus the unused first page, which keeps every arena address nonzero. */
const pagesFor = (bytes: number): number => Math.ceil((WASM_PAGE_BYTES + bytes) / WASM_PAGE_BYTES);

/**
 * Shared memory reserved at its full and maximum size up front: it can never grow afterwards, so
 * views over its buffer stay complete. Undefined when the browser refuses the reservation (iOS can
 * refuse large shared memories).
 */
function sharedArena(bytes: number): WebAssembly.Memory | undefined {
  const pages = pagesFor(bytes);
  try {
    return new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
  } catch {
    return undefined;
  }
}

/**
 * The single allocation the translated tier makes for its arena, served from a Wasm memory of
 * its own instead of an interpreter's heap. Reserved pages stay uncommitted until touched. On a
 * cross-origin isolated page the memory is shared; otherwise it is an ordinary growable memory.
 */
export class ArenaHeap implements TierModule {
  readonly #memory: WebAssembly.Memory;
  readonly shared: boolean;
  #allocated = false;
  /** `reserve` is the arena size `_malloc` will be asked for; only a shared memory uses it up front. */
  constructor(reserve: number, isolated = crossOriginIsolation()) {
    const shared = isolated ? sharedArena(reserve) : undefined;
    this.shared = shared !== undefined;
    this.#memory = shared ?? new WebAssembly.Memory({ initial: 1 });
  }
  get HEAPU8(): Uint8Array {
    return new Uint8Array(this.#memory.buffer);
  }
  /** Returns the arena's address; there is exactly one allocation. */
  _malloc(bytes: number): number {
    if (this.#allocated) return 0;
    const pages = pagesFor(bytes),
      current = this.#memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) {
      if (this.shared) return 0;
      try {
        this.#memory.grow(pages - current);
      } catch {
        return 0;
      }
    }
    this.#allocated = true;
    return WASM_PAGE_BYTES;
  }
  _free(): void {
    this.#allocated = false;
  }
  getTciMemory(): WebAssembly.Memory {
    return this.#memory;
  }
}
