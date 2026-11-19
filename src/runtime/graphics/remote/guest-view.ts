import type { GuestMemory } from "../../memory/guest-memory";

const HEX = 16;

/**
 * Guest memory as an execution worker sees it: guest address A is host byte `arena + A` of the
 * shared Wasm memory. The main thread's page table is not shared, so unmapped pages read as zeros
 * here instead of faulting; GL calls only touch the buffers their guest passes.
 */
export class GuestView implements GuestMemory {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  constructor(
    memory: WebAssembly.Memory,
    private readonly arena: number,
    /** Guest span minus one; the span is a power of two. */
    private readonly mask: number,
  ) {
    this.#bytes = new Uint8Array(memory.buffer);
    this.#view = new DataView(memory.buffer);
  }
  #host(address: number, size: number): number {
    if (!Number.isInteger(address) || address < 0 || address + size > this.mask + 1)
      throw new RangeError(
        `Guest range 0x${address.toString(HEX)}+${size} is outside guest memory.`,
      );
    return this.arena + address;
  }
  read(address: number, size: number): Uint8Array {
    const host = this.#host(address, size);
    return this.#bytes.slice(host, host + size);
  }
  write(address: number, bytes: Uint8Array): void {
    this.#bytes.set(bytes, this.#host(address, bytes.length));
  }
  read32(address: number): number {
    return this.#view.getUint32(this.#host(address, Uint32Array.BYTES_PER_ELEMENT), true);
  }
}
