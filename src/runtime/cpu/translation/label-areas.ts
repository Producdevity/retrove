import type { ArenaRegion } from "./layout";

const CROWDED_DIVISOR = 2;

/**
 * Hands out each module's label block from the arena's label area. Blocks are never shared or
 * reused before a flush, because a function stays reachable in every module that contains it.
 */
export class LabelAreas {
  #next: number;
  constructor(
    private readonly arena: number,
    private readonly region: ArenaRegion,
  ) {
    this.#next = region.labels;
  }
  /** Host address of a fresh block, or undefined when the area is full. */
  allocate(bytes: number): number | undefined {
    if (this.#next + bytes > this.region.bytes) return undefined;
    const block = this.arena + this.#next;
    this.#next += bytes;
    return block;
  }
  /** Over half the area is in use, so the next batch should start from a flush. */
  get crowded(): boolean {
    const used = this.#next - this.region.labels;
    return used > (this.region.bytes - this.region.labels) / CROWDED_DIVISOR;
  }
  /** Every module was dropped, so no block is referenced any more. */
  reset(): void {
    this.#next = this.region.labels;
  }
}
