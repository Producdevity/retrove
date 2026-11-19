import { GUEST_SPAN_MASK, GuestLayout } from "../../memory/guest-layout";
import { arenaRegion, MaxCodeBytes, PageBits, PageBytes, type ArenaRegion } from "./layout";

const PAGE_OFFSET_MASK = PageBytes - 1;
/** Bytes a heap must reserve for the arena of a guest span (allocations align up to a page). */
export const arenaReservation = (span: number = GuestLayout.Span, maxCode = MaxCodeBytes): number =>
  arenaRegion(span, maxCode).bytes + PageBytes;
/** Whether a memory is a shared WebAssembly.Memory, whose buffer is a SharedArrayBuffer. */
export const sharedMemory = (memory: WebAssembly.Memory): boolean =>
  typeof SharedArrayBuffer !== "undefined" && memory.buffer instanceof SharedArrayBuffer;
export interface HostHeap {
  readonly HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(address: number): void;
}
/**
 * Guest memory is one flat arena in the Unicorn heap, followed by the translator's state and
 * tables at fixed offsets (see `arenaRegion`): guest address A lives at `arena + A`, so
 * Unicorn (uc_mem_map_ptr) and translated code share the same bytes and translated code needs no
 * page table. Pages outside mapped regions are readable zeros to translated code; Unicorn still
 * faults on them.
 */
export class GuestPages {
  readonly arena: number;
  /** Offsets from `arena` of the translator's state, tables and label areas. */
  readonly region: ArenaRegion;
  /** Shared memories can be run by several threads; translated modules must be emitted for them. */
  readonly shared: boolean;
  readonly #heap: HostHeap;
  readonly #memory: WebAssembly.Memory;
  readonly #allocation: number;
  readonly #span: number;
  readonly #mapped: Uint8Array;
  readonly #regions = new Map<number, number>();
  #view: DataView;
  #bytes: Uint8Array;
  #words: Int32Array;
  constructor(
    heap: HostHeap,
    memory: WebAssembly.Memory,
    span: number = GuestLayout.Span,
    maxCode = MaxCodeBytes,
  ) {
    this.#heap = heap;
    this.#memory = memory;
    this.#span = span;
    this.region = arenaRegion(span, maxCode);
    this.#allocation = heap._malloc(arenaReservation(span, maxCode));
    if (!this.#allocation) throw new Error("Unable to reserve guest memory.");
    this.arena = Math.ceil(this.#allocation / PageBytes) * PageBytes;
    this.#mapped = new Uint8Array(span / PageBytes);
    this.shared = sharedMemory(memory);
    this.#bytes = new Uint8Array(memory.buffer);
    this.#view = new DataView(memory.buffer);
    this.#words = new Int32Array(memory.buffer);
    // A shared buffer never detaches, so views taken now must already cover the whole arena.
    if (this.shared && this.#bytes.length < this.arena + this.region.bytes)
      throw new Error("Shared guest memory does not cover the arena.");
  }
  /** Growing an unshared memory detaches its buffer, which empties the cached views; `buffer` itself is slow to read. */
  #current(): void {
    if (this.#bytes.length) return;
    this.#bytes = new Uint8Array(this.#memory.buffer);
    this.#view = new DataView(this.#memory.buffer);
    this.#words = new Int32Array(this.#memory.buffer);
  }
  /** Mask translated code applies to guest addresses; the span is a power of two. */
  get mask(): number {
    return this.#span === GuestLayout.Span ? GUEST_SPAN_MASK : this.#span - 1;
  }
  /** Reads guest memory for executable discovery; unmapped bytes read as empty. */
  get reader(): {
    word(address: number): number | undefined;
    read(address: number, length: number): Uint8Array;
  } {
    return {
      word: (address) => this.word(address),
      read: (address, length) => {
        const bytes = new Uint8Array(length);
        return this.read(address, bytes) ? bytes : new Uint8Array(0);
      },
    };
  }
  get view(): DataView {
    this.#current();
    return this.#view;
  }
  get bytes(): Uint8Array {
    this.#current();
    return this.#bytes;
  }
  /** Word view for `Atomics`; index a host address divided by the word size. */
  get words(): Int32Array {
    this.#current();
    return this.#words;
  }
  get regions(): Iterable<number> {
    return this.#regions.keys();
  }
  /** Host address of the main thread's state block. */
  get mainState(): number {
    return this.arena + this.region.state;
  }
  /**
   * Maps a region and returns its host address for Unicorn. The arena starts zeroed and unmap
   * zeroes what it releases, so mapping never touches (and commits) memory the guest has not used.
   */
  map(address: number, size: number): number {
    if (address < 0 || address + size > this.#span)
      throw new Error(`Guest region at ${address} is outside the guest address span.`);
    const host = this.arena + address;
    this.#mapped.fill(1, address / PageBytes, (address + size) / PageBytes);
    this.#regions.set(address, size);
    return host;
  }
  unmap(address: number, size: number): void {
    if (address < 0 || address + size > this.#span) return;
    this.#heap.HEAPU8.fill(0, this.arena + address, this.arena + address + size);
    this.#mapped.fill(0, address / PageBytes, (address + size) / PageBytes);
    if (this.#regions.get(address) === size) this.#regions.delete(address);
  }
  mapped(address: number): boolean {
    return this.#mapped[address >>> PageBits] === 1;
  }
  /** Host byte address of a guest address, or -1 when its page is unmapped. */
  host(address: number): number {
    return this.mapped(address) ? this.arena + address : -1;
  }
  word(address: number): number | undefined {
    const host = this.host(address);
    return host < 0 ? undefined : this.view.getUint32(host, true);
  }
  /** Copies guest bytes page by page; returns false when a page is unmapped. */
  read(address: number, target: Uint8Array): boolean {
    for (let index = 0; index < target.length;) {
      const guest = address + index,
        count = Math.min(target.length - index, PageBytes - (guest & PAGE_OFFSET_MASK)),
        host = this.host(guest);
      if (host < 0 || host + count > this.bytes.length) return false;
      target.set(this.bytes.subarray(host, host + count), index);
      index += count;
    }
    return true;
  }
  /** Writes guest bytes page by page; returns false when a page is unmapped. */
  write(address: number, source: Uint8Array): boolean {
    for (let index = 0; index < source.length;) {
      const guest = address + index,
        count = Math.min(source.length - index, PageBytes - (guest & PAGE_OFFSET_MASK)),
        host = this.host(guest);
      if (host < 0 || host + count > this.bytes.length) return false;
      this.bytes.set(source.subarray(index, index + count), host);
      index += count;
    }
    return true;
  }
  /** Copies of the mapped runs of pages in [start, end); unmapped pages are left out. */
  snapshots(start: number, end: number): { start: number; bytes: Uint8Array }[] {
    const runs: { start: number; bytes: Uint8Array }[] = [];
    let run = -1;
    for (let page = start - (start & PAGE_OFFSET_MASK); page < end; page += PageBytes) {
      if (this.mapped(page)) {
        if (run < 0) run = Math.max(page, start);
        if (page + PageBytes < end) continue;
      }
      const runEnd = Math.min(this.mapped(page) ? page + PageBytes : page, end);
      if (run >= 0 && runEnd > run) {
        const bytes = new Uint8Array(runEnd - run);
        if (this.read(run, bytes)) runs.push({ start: run, bytes });
      }
      run = -1;
    }
    return runs;
  }
  close(): void {
    this.#heap._free(this.#allocation);
    this.#regions.clear();
  }
}
