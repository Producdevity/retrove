import { Guard, MappedDelta, PageBits, PageBytes, PageTableBytes, UnmappedDelta } from "./layout";

const WORD_BYTES = 4;
const PAGE_COUNT = PageTableBytes / WORD_BYTES;
const PAGE_OFFSET_MASK = PageBytes - 1;
export interface HostHeap {
  readonly HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(address: number): void;
}
interface Region {
  readonly host: number;
  readonly allocation: number;
  readonly size: number;
}
/**
 * Guest pages live in the Unicorn heap so Unicorn (uc_mem_map_ptr) and translated code share the
 * same bytes. The table holds one host-minus-guest delta per guest page; unmapped pages hold a
 * delta that makes the translated access fault past the end of memory.
 */
export class GuestPages {
  readonly table: number;
  readonly #heap: HostHeap;
  readonly #memory: WebAssembly.Memory;
  readonly #regions = new Map<number, Region>();
  #deltas: Int32Array | undefined;
  #view: DataView | undefined;
  #bytes: Uint8Array | undefined;
  constructor(heap: HostHeap, memory: WebAssembly.Memory, table: number) {
    this.#heap = heap;
    this.#memory = memory;
    this.table = table;
    const deltas = this.deltas;
    for (let page = 0; page < PAGE_COUNT; page++) deltas[page] = UnmappedDelta(page * PageBytes);
  }
  static readonly tableBytes = PAGE_COUNT * WORD_BYTES;
  get deltas(): Int32Array {
    if (this.#deltas?.buffer !== this.#memory.buffer)
      this.#deltas = new Int32Array(this.#memory.buffer, this.table, PAGE_COUNT);
    return this.#deltas;
  }
  get view(): DataView {
    if (this.#view?.buffer !== this.#memory.buffer) this.#view = new DataView(this.#memory.buffer);
    return this.#view;
  }
  get bytes(): Uint8Array {
    if (this.#bytes?.buffer !== this.#memory.buffer)
      this.#bytes = new Uint8Array(this.#memory.buffer);
    return this.#bytes;
  }
  get regions(): Iterable<number> {
    return this.#regions.keys();
  }
  map(address: number, size: number): number {
    const allocation = this.#heap._malloc(size + PageBytes);
    if (!allocation) throw new Error("Unable to allocate guest memory.");
    const host = Math.ceil(allocation / PageBytes) * PageBytes;
    this.#heap.HEAPU8.fill(0, host, host + size);
    this.#regions.set(address, { host, allocation, size });
    const deltas = this.deltas;
    for (let offset = 0; offset < size; offset += PageBytes)
      deltas[(address + offset) / PageBytes] = MappedDelta(address, host);
    return host;
  }
  unmap(address: number, size: number): void {
    const deltas = this.deltas;
    for (let offset = 0; offset < size; offset += PageBytes)
      deltas[(address + offset) / PageBytes] = UnmappedDelta(address + offset);
    const region = this.#regions.get(address);
    if (region?.size === size) {
      this.#heap._free(region.allocation);
      this.#regions.delete(address);
    }
  }
  mapped(address: number): boolean {
    const page = address >>> PageBits;
    return this.deltas[page] !== UnmappedDelta(page * PageBytes);
  }
  /** Host byte address of a guest address, or -1 when its page is unmapped. */
  host(address: number): number {
    const page = address >>> PageBits,
      delta = this.deltas[page];
    if (delta === undefined || delta === UnmappedDelta(page * PageBytes)) return -1;
    return (address + delta + Guard) >>> 0;
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
    for (const region of this.#regions.values()) this.#heap._free(region.allocation);
    this.#regions.clear();
  }
}
