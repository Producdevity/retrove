import { functionAt, type Executable } from "./executable";
import type { PageEntries } from "./foreign-pages";
import type { CodeSnapshot } from "./translation-job";
import type { ProfileRecorder } from "./translation-profile";
import { PageBytes } from "./layout";
import type { FunctionRange } from "./translation-types";

const THUMB_BIT = 1;
const WORD_BYTES = 4;

/**
 * The function containing `pc`, or, for code the executable lists no function for, the code from
 * `pc` to the next listed function (at most a page), in `pc`'s instruction set.
 */
export function codeRangeAt(executable: Executable, pc: number): FunctionRange | undefined {
  const known = functionAt(executable, pc);
  if (known) return known;
  const address = pc & ~THUMB_BIT;
  if (address < executable.codeStart || address >= executable.codeEnd) return undefined;
  let end = Math.min(executable.codeEnd, address + PageBytes);
  for (const range of executable.ranges) {
    const start = range.start & ~THUMB_BIT;
    if (start > address) {
      end = Math.min(end, start);
      break;
    }
  }
  return { start: pc, end };
}

/**
 * Code bytes translated at once for a very large function (executables without function starts
 * can yield whole-section "functions"); larger functions are translated in windows from each entry.
 */
export const DEMAND_WINDOW_BYTES = 0x4000;

function windowAt(range: FunctionRange, pc: number): FunctionRange {
  const address = pc & ~THUMB_BIT;
  if (range.end - (range.start & ~THUMB_BIT) <= DEMAND_WINDOW_BYTES) return range;
  return { start: pc, end: Math.min(range.end, address + DEMAND_WINDOW_BYTES) };
}

export interface Demand {
  /** The executable function (or code run) to install; undefined for a page outside it. */
  readonly range: FunctionRange | undefined;
  readonly function: FunctionRange;
  readonly entries: readonly number[];
  readonly pages: readonly CodeSnapshot[];
}
/**
 * What to translate so `pc` can run now: its executable function with every entry seen so far,
 * or its whole page when the code lies outside the executable (ARM only).
 */
export function demandAt(
  pc: number,
  executable: Executable | undefined,
  profile: ProfileRecorder,
  foreign: PageEntries,
): Demand | undefined {
  const known = executable && codeRangeAt(executable, pc);
  if (known) {
    const range = windowAt(known, pc);
    if (range !== known) return { range, function: range, entries: [pc], pages: [] };
    if (pc !== range.start) profile.addEntry(range.start, pc);
    const entries = [...profile.entriesOf([range]), pc];
    return { range, function: range, entries, pages: [] };
  }
  const start = Math.floor(pc / PageBytes) * PageBytes,
    pages = foreign.snapshots(start, start + PageBytes + PageBytes);
  if (pc & (WORD_BYTES - 1) || !pages.length) return undefined;
  const entries = foreign.add(start / PageBytes, pc);
  return { range: undefined, function: { start, end: start + PageBytes }, entries, pages };
}
