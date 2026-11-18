import { functionAt, type Executable } from "./executable";
import type { FunctionRange } from "./translation-types";

const WORD_BYTES = 4;
const THUMB_BIT = 1;
/** Entries found inside one function after translation; more than this keeps the rest on the interpreter. */
export const MAX_EXTRA_ENTRIES = 64;

/** Version 2 records only functions that became hot; version 1 recorded every function that ran. */
export const PROFILE_VERSION = 2;
/** What an app translated in earlier launches, replayed at the next launch. */
export interface TranslationProfile {
  readonly version: typeof PROFILE_VERSION;
  /** Function starts in the order they were first translated. */
  readonly functions: readonly number[];
  /** Function start and the entries found inside it after translation. */
  readonly entries: readonly (readonly [number, readonly number[]])[];
}
export interface BatchLimits {
  readonly instructions: number;
  readonly functions: number;
}

function addresses(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item));
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function decodeProfile(value: unknown): TranslationProfile | undefined {
  if (
    !record(value) ||
    value.version !== PROFILE_VERSION ||
    !addresses(value.functions) ||
    !Array.isArray(value.entries)
  )
    return undefined;
  const items: unknown[] = value.entries,
    entries: [number, number[]][] = [];
  for (const item of items) {
    if (!Array.isArray(item)) return undefined;
    const start: unknown = item[0],
      list: unknown = item[1];
    if (typeof start !== "number" || !Number.isSafeInteger(start) || !addresses(list))
      return undefined;
    entries.push([start, list]);
  }
  return { version: PROFILE_VERSION, functions: value.functions, entries };
}
/** Splits profiled functions into batches in first-translated order, so the same profile yields the same jobs. */
export function profileBatches(
  profile: TranslationProfile,
  executable: Executable,
  limits: BatchLimits,
): FunctionRange[][] {
  const batches: FunctionRange[][] = [],
    seen = new Set<number>();
  let batch: FunctionRange[] = [],
    instructions = 0;
  for (const start of profile.functions) {
    const range = functionAt(executable, start);
    if (!range || range.start !== start || seen.has(start)) continue;
    seen.add(start);
    batch.push(range);
    instructions += (range.end - (range.start & ~THUMB_BIT)) / WORD_BYTES;
    if (batch.length < limits.functions && instructions < limits.instructions) continue;
    batches.push(batch);
    batch = [];
    instructions = 0;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
/** Collects translated functions and found entries, starting from the profile of earlier launches. */
export class ProfileRecorder {
  readonly entries = new Map<number, Set<number>>();
  readonly #functions: number[] = [];
  readonly #known = new Set<number>();
  #changed = false;
  #saving: ReturnType<typeof setTimeout> | undefined;
  constructor(profile: TranslationProfile | undefined) {
    if (!profile) return;
    for (const start of profile.functions) this.#add(start);
    for (const [start, list] of profile.entries)
      this.entries.set(start, new Set(list.slice(0, MAX_EXTRA_ENTRIES + 1)));
  }
  #add(start: number): boolean {
    if (this.#known.has(start)) return false;
    this.#known.add(start);
    this.#functions.push(start);
    return true;
  }
  record(start: number): void {
    if (this.#add(start)) this.#changed = true;
  }
  /** Adds an entry inside a function; false when it is known or the function has too many. */
  addEntry(start: number, pc: number): boolean {
    const entries = this.entries.get(start) ?? new Set<number>();
    if (entries.has(pc) || entries.size > MAX_EXTRA_ENTRIES) return false;
    entries.add(pc);
    this.entries.set(start, entries);
    this.#changed = true;
    return true;
  }
  entriesOf(functions: readonly FunctionRange[]): number[] {
    return functions.flatMap((range) => [...(this.entries.get(range.start) ?? [])]);
  }
  /** Saves the profile after `delayMs` unless a save is already waiting. */
  scheduleSave(save: ((profile: TranslationProfile) => void) | undefined, delayMs: number): void {
    if (!save || this.#saving !== undefined) return;
    this.#saving = setTimeout(() => {
      this.#saving = undefined;
      this.flush(save);
    }, delayMs);
  }
  flush(save: ((profile: TranslationProfile) => void) | undefined): void {
    clearTimeout(this.#saving);
    this.#saving = undefined;
    const profile = this.take();
    if (profile) save?.(profile);
  }
  /** The profile, when it changed since the last call. */
  take(): TranslationProfile | undefined {
    if (!this.#changed) return undefined;
    this.#changed = false;
    return {
      version: PROFILE_VERSION,
      functions: [...this.#functions],
      entries: [...this.entries].map(([start, list]) => [start, [...list]]),
    };
  }
}
