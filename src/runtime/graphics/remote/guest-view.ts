import type { AtomicGuestMemory } from "../../memory/guest-atomics";

const HEX = 16;
const WORD_BYTES = Int32Array.BYTES_PER_ELEMENT;

/**
 * Guest memory as an execution worker sees it: guest address A is host byte `arena + A` of the
 * shared Wasm memory. The main thread's page table is not shared, so unmapped pages read as zeros
 * here instead of faulting; GL calls only touch the buffers their guest passes.
 */
export class GuestView implements AtomicGuestMemory {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #words: Int32Array;
  constructor(
    memory: WebAssembly.Memory,
    private readonly arena: number,
    /** Guest span minus one; the span is a power of two. */
    private readonly mask: number,
  ) {
    this.#bytes = new Uint8Array(memory.buffer);
    this.#view = new DataView(memory.buffer);
    this.#words = new Int32Array(memory.buffer);
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
  /** `Atomics` index of an aligned guest word, so it holds against other guest threads. */
  #word(address: number): number {
    const host = this.#host(address, WORD_BYTES);
    if (host % WORD_BYTES) throw new RangeError("Atomic guest words must be aligned");
    return host / WORD_BYTES;
  }
  compareExchange32(address: number, expected: number, replacement: number): number {
    return (
      Atomics.compareExchange(this.#words, this.#word(address), expected | 0, replacement | 0) >>> 0
    );
  }
  add32(address: number, delta: number): number {
    return Atomics.add(this.#words, this.#word(address), delta | 0) >>> 0;
  }
  store32(address: number, value: number): void {
    Atomics.store(this.#words, this.#word(address), value | 0);
  }
}
