import { ForeignProbes } from "./translate";

export const FOREIGN_SLOTS = 1024;
const SLOT_BYTES = 8;
const VALUE_OFFSET = 4;
const TOMBSTONE = 0xffffffff;
/**
 * Open-addressed table of guest page + 1 -> function table slot + 1 for code pages outside the main
 * executable. Translated code probes the same layout, so the probe sequence must match the emitter.
 */
export class ForeignPages {
  static readonly bytes = FOREIGN_SLOTS * SLOT_BYTES;
  readonly #base: number;
  readonly #view: () => DataView;
  constructor(base: number, view: () => DataView) {
    this.#base = base;
    this.#view = view;
  }
  #slot(page: number, insert: boolean): number {
    const view = this.#view();
    for (let probe = 0; probe < ForeignProbes; probe++) {
      const slot = (page + 1 + probe) & (FOREIGN_SLOTS - 1),
        key = view.getUint32(this.#base + slot * SLOT_BYTES, true);
      if (key === page + 1) return slot;
      if (insert && key === 0) return slot;
    }
    return -1;
  }
  /** Function table slot + 1 for a page, or 0. */
  entry(page: number): number {
    const slot = this.#slot(page, false);
    return slot < 0
      ? 0
      : this.#view().getUint32(this.#base + slot * SLOT_BYTES + VALUE_OFFSET, true);
  }
  /** Returns false when every probe position is taken. */
  set(page: number, tableSlot: number): boolean {
    const slot = this.#slot(page, true);
    if (slot < 0) return false;
    const view = this.#view();
    view.setUint32(this.#base + slot * SLOT_BYTES + VALUE_OFFSET, tableSlot + 1, true);
    view.setUint32(this.#base + slot * SLOT_BYTES, page + 1, true);
    return true;
  }
  /** Returns whether the page had a translation. */
  remove(page: number): boolean {
    const slot = this.#slot(page, false);
    if (slot < 0) return false;
    const view = this.#view();
    view.setUint32(this.#base + slot * SLOT_BYTES + VALUE_OFFSET, 0, true);
    view.setUint32(this.#base + slot * SLOT_BYTES, TOMBSTONE, true);
    return true;
  }
}
/** Foreign code pages waiting for translation, with the entries seen on each page. */
export class ForeignQueue {
  readonly #entries = new Map<number, Set<number>>();
  readonly #queued = new Set<number>();
  get size(): number {
    return this.#queued.size;
  }
  /** Queues the page for an entry; false when the entry was already known. */
  note(page: number, pc: number): boolean {
    const entries = this.#entries.get(page) ?? new Set<number>();
    if (entries.has(pc)) return false;
    entries.add(pc);
    this.#entries.set(page, entries);
    this.#queued.add(page);
    return true;
  }
  /** Queued pages with all their entries; empties the queue. */
  take(): [number, number[]][] {
    const pages = [...this.#queued].map((page): [number, number[]] => [
      page,
      [...(this.#entries.get(page) ?? [])],
    ]);
    this.#queued.clear();
    return pages;
  }
  forget(page: number): void {
    this.#entries.delete(page);
  }
}
