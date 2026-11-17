import { calleeStarts } from "./callees";
import { functionAt, type Executable } from "./executable";
import type { BatchLimits } from "./translation-profile";
import type { FunctionRange } from "./translation-types";

const WORD_BYTES = 4;
const THUMB_BIT = 1;

/**
 * Takes queued functions up to the batch limits, adding the direct callees of ARM functions so their
 * calls stay inside Wasm. Taken and already handled starts leave the queue.
 */
export function collectBatch(input: {
  readonly queued: Set<number>;
  readonly executable: Executable;
  readonly handled: (start: number) => boolean;
  readonly readWord: (address: number) => number | undefined;
  readonly limits: BatchLimits;
}): FunctionRange[] {
  const { queued, executable, handled, readWord, limits } = input,
    ranges: FunctionRange[] = [],
    taken = new Set<number>();
  let instructions = 0;
  const take = (start: number, callee: boolean): void => {
    const range = functionAt(executable, start);
    if (!range || handled(range.start) || taken.has(range.start)) return;
    ranges.push(range);
    taken.add(range.start);
    instructions += (range.end - (range.start & ~THUMB_BIT)) / WORD_BYTES;
    queued.delete(range.start);
    if (callee || range.start & THUMB_BIT) return;
    for (const target of calleeStarts(range, readWord)) {
      if (ranges.length >= limits.functions) break;
      take(target, true);
    }
  };
  for (const start of [...queued]) {
    if (ranges.length >= limits.functions || instructions >= limits.instructions) break;
    queued.delete(start);
    take(start, false);
  }
  return ranges;
}
