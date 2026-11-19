import { TableBytesPerCodeByte, type ArenaRegion } from "./layout";
import type { FunctionRange } from "./translation-types";

const THUMB_BIT = 1;
const LABEL_ALIGNMENT = 16;

/**
 * Places label tables at fixed offsets from the arena: a main-executable function's table sits at
 * `labels + 2 * code offset`, so a module translated in any session, or ahead of time, finds it.
 * Code outside the executable gets tables from a bump area that a flush resets.
 */
export class LabelAreas {
  #foreignNext: number;
  constructor(
    private readonly arena: number,
    private readonly region: ArenaRegion,
  ) {
    this.#foreignNext = region.foreignLabels;
  }
  address(
    range: FunctionRange,
    code: { readonly start: number; readonly end: number } | undefined,
  ): number {
    const start = range.start & ~THUMB_BIT;
    if (code && start >= code.start && range.end <= code.end)
      return this.arena + this.region.labels + TableBytesPerCodeByte * (start - code.start);
    const bytes = TableBytesPerCodeByte * (range.end - start);
    const offset = Math.ceil(this.#foreignNext / LABEL_ALIGNMENT) * LABEL_ALIGNMENT;
    if (offset + bytes > this.region.bytes) throw new Error("Foreign label area is full.");
    this.#foreignNext = offset + bytes;
    return this.arena + offset;
  }
  /** Every module was dropped, so no foreign table is referenced any more. */
  reset(): void {
    this.#foreignNext = this.region.foreignLabels;
  }
}
