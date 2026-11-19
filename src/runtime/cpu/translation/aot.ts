import type { Executable } from "./executable";
import type { TranslationJob } from "./translation-job";
import type { FunctionRange } from "./translation-types";
import { aotSlot } from "./translation-store";

export { translationAheadEnabled } from "./settings";

const THUMB_BIT = 1;
const WORD_BYTES = 4;
/** Small enough that loading a chunk for one function costs little of the code budget. */
export const AotChunk = { instructions: 4_000, functions: 64 } as const;
/**
 * Entries before a function's prepared chunk loads. Loading on the first entry pulled in so many
 * cold neighbours during BioShock's boot that the code budget flushed hundreds of times.
 */
export const AOT_HOT_ENTRIES = 2;
/** Lets the guest and urgent translation run between background chunks. */
const PREPARE_PAUSE_MS = 20;

export interface AotHost<Job = TranslationJob> {
  /** Builds the job for a chunk; its module is cached under `cacheKey`. */
  job(functions: readonly FunctionRange[], cacheKey: string): Job;
  /** Translates into the cache without returning the module; false when nothing was cached. */
  prepare(job: Job): Promise<boolean>;
  /** Whether translation the guest is waiting for is pending, so preparation should wait. */
  busy(): boolean;
  closed(): boolean;
  progress(prepared: number, chunks: number): void;
}

/** Splits the executable's functions into address-ordered chunks of bounded size. */
export function aotChunks(executable: Executable): FunctionRange[][] {
  const chunks: FunctionRange[][] = [];
  let chunk: FunctionRange[] = [],
    instructions = 0;
  for (const range of executable.ranges) {
    chunk.push(range);
    instructions += (range.end - (range.start & ~THUMB_BIT)) / WORD_BYTES;
    if (chunk.length < AotChunk.functions && instructions < AotChunk.instructions) continue;
    chunks.push(chunk);
    chunk = [];
    instructions = 0;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/**
 * Ahead-of-time translation. Every function of the executable is translated in the background
 * into the module cache, chunk by chunk; on later launches that pass only revalidates the cache.
 * A function entered twice installs its whole chunk from the cache instead of waiting to become
 * hot and be translated on its own.
 */
export class AheadOfTime<Job = TranslationJob> {
  readonly #chunks: FunctionRange[][];
  readonly #starts: number[];
  readonly #prepared = new Set<number>();
  readonly #loaded = new Set<number>();
  readonly #queued: number[] = [];
  #suspended = false;
  constructor(
    executable: Executable,
    private readonly app: string,
    private readonly host: AotHost<Job>,
  ) {
    this.#chunks = aotChunks(executable);
    this.#starts = this.#chunks.map((chunk) => chunk[0]?.start ?? 0);
  }
  get prepared(): number {
    return this.#prepared.size;
  }
  get chunks(): number {
    return this.#chunks.length;
  }
  get waiting(): number {
    return this.#queued.length;
  }
  #chunkOf(start: number): number {
    let low = 0,
      high = this.#starts.length - 1,
      found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((this.#starts[middle] ?? Infinity) <= start) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  }
  /**
   * Queues the chunk holding `start`; the worker serves it from the cache, or translates it when
   * the background pass has not reached it yet. False when the function must be translated alone.
   */
  request(start: number): boolean {
    const chunk = this.#chunkOf(start);
    if (this.#suspended || chunk < 0 || this.#loaded.has(chunk)) return false;
    if (!this.#queued.includes(chunk)) this.#queued.push(chunk);
    return true;
  }
  /** The next queued chunk's job; its module comes from the cache. */
  take(): Job | undefined {
    const chunk = this.#queued.shift();
    if (chunk === undefined) return undefined;
    this.#loaded.add(chunk);
    return this.host.job(this.#chunks[chunk] ?? [], aotSlot(this.app, chunk));
  }
  /**
   * Every module was dropped because live code passed its budget. Whole chunks carry many cold
   * neighbours, so from then on functions translate alone; in BioShock's levels chunk loading
   * flushed dozens of times and dropped to a few frames per second.
   */
  suspend(): void {
    this.#suspended = true;
    this.#loaded.clear();
    this.#queued.length = 0;
  }
  /** Prepares every chunk in address order, pausing while urgent translation is pending. */
  async start(): Promise<void> {
    for (let chunk = 0; chunk < this.#chunks.length; chunk++) {
      while (this.host.busy() && !this.host.closed())
        await new Promise((resolve) => setTimeout(resolve, PREPARE_PAUSE_MS));
      if (this.host.closed()) return;
      const functions = this.#chunks[chunk] ?? [];
      if (await this.host.prepare(this.host.job(functions, aotSlot(this.app, chunk))))
        this.#prepared.add(chunk);
      this.host.progress(this.#prepared.size, this.#chunks.length);
    }
  }
}
