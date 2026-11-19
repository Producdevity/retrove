import type { StateLayout } from "./layout";
import type { FunctionRange } from "./translation-types";

const HALFWORD_BYTES = 2;
const THUMB_BIT = 1;

/** Main-executable halfword -> function table slot + 1, read by translated code; 0 runs on the interpreter. */
export class FunctionIndex {
  /** Index entries live in reserved pages; untouched entries cost no memory. */
  readonly #indexed = new Map<number, FunctionRange>();
  constructor(
    private readonly view: () => DataView,
    private readonly region: () => StateLayout["index"],
  ) {}
  static bytes(span: number): number {
    return HALFWORD_BYTES * span;
  }
  #address(address: number): number {
    const region = this.region();
    return region.base + HALFWORD_BYTES * (address - region.start);
  }
  /** Slot + 1 for a PC inside the executable, or undefined outside it. */
  get(pc: number): number | undefined {
    const region = this.region(),
      address = pc & ~THUMB_BIT;
    if (address < region.start || address >= region.end) return undefined;
    return this.view().getUint32(this.#address(address), true);
  }
  /** Sends every indexed function back to the interpreter, touching only their entries. */
  clear(): void {
    for (const range of [...this.#indexed.values()]) this.set(range, 0);
  }
  set(range: FunctionRange, entry: number): void {
    const view = this.view();
    for (let at = range.start & ~THUMB_BIT; at < range.end; at += HALFWORD_BYTES)
      view.setUint32(this.#address(at), entry, true);
    if (entry) this.#indexed.set(range.start, range);
    else this.#indexed.delete(range.start);
  }
}
