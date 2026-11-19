import type { TierModule } from "../translation/tier-options";

const WASM_PAGE_BYTES = 65_536;

/**
 * The single allocation the translated tier makes for its arena, served from a Wasm memory of
 * its own instead of an interpreter's heap. Reserved pages stay uncommitted until touched.
 */
export class ArenaHeap implements TierModule {
  readonly #memory = new WebAssembly.Memory({ initial: 1 });
  #allocated = false;
  get HEAPU8(): Uint8Array {
    return new Uint8Array(this.#memory.buffer);
  }
  /** Returns the arena's address; there is exactly one allocation. */
  _malloc(bytes: number): number {
    if (this.#allocated) return 0;
    const pages = Math.ceil((WASM_PAGE_BYTES + bytes) / WASM_PAGE_BYTES);
    try {
      this.#memory.grow(pages - this.#memory.buffer.byteLength / WASM_PAGE_BYTES);
    } catch {
      return 0;
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
