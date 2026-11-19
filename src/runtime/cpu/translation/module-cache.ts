import { sha256 } from "./digest";
import { runJob, type JobResult, type TranslationJob } from "./translation-job";
import { TranslationStore, VERSION_SEPARATOR, type TranslationDatabase } from "./translation-store";
import type { TranslatedFunction, Translation, TranslationStatistics } from "./translation-types";
import { ModuleFormat } from "./wasm-module";

const HALFWORD_BYTES = 2;
const WORD_BYTES = 4;
const PAIR = 2;
/** Shared-memory modules import a different memory type, so they keep slots of their own. */
const SHARED_SLOT = "+shared";

/** A module with digests of its job and of the guest bytes it read, both checked before reuse. */
interface CachedModule {
  readonly job: string;
  readonly reads: Uint32Array;
  readonly digest: string;
  readonly translation: Translation;
}
type ReadWord = (address: number) => number | undefined;

/** Everything besides guest bytes that decides a job's output. */
function describe(job: TranslationJob): string {
  return JSON.stringify({
    format: ModuleFormat,
    shared: job.shared,
    functions: job.functions,
    entries: job.entries,
    layout: job.layout,
    stopPC: job.stopPC,
    labels: [...job.labels].sort((a, b) => a[0] - b[0]),
    code: job.code ?? null,
  });
}
/** Read addresses as [start, end) pairs stepping by a halfword; nearby reads merge so lists stay short. */
export function readRanges(addresses: Iterable<number>): Uint32Array<ArrayBuffer> {
  const sorted = [...addresses].sort((a, b) => a - b),
    ranges: number[] = [];
  let start = -1,
    last = -1;
  for (const address of sorted) {
    if (start >= 0 && address - last <= WORD_BYTES && (address - start) % HALFWORD_BYTES === 0) {
      last = address;
      continue;
    }
    if (start >= 0) ranges.push(start, last + HALFWORD_BYTES);
    start = last = address;
  }
  if (start >= 0) ranges.push(start, last + HALFWORD_BYTES);
  return Uint32Array.from(ranges);
}
export function readValues(
  ranges: Uint32Array,
  word: ReadWord,
): Uint32Array<ArrayBuffer> | undefined {
  const values: number[] = [];
  for (let index = 0; index + 1 < ranges.length; index += PAIR)
    for (
      let at = ranges[index] ?? 0, end = ranges[index + 1] ?? 0;
      at < end;
      at += HALFWORD_BYTES
    ) {
      const value = word(at);
      if (value === undefined) return undefined;
      values.push(value);
    }
  return Uint32Array.from(values);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function numbers(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "number");
}
function isWasm(value: unknown): value is Uint8Array<ArrayBuffer> {
  return value instanceof Uint8Array && value.buffer instanceof ArrayBuffer;
}
function isFunction(value: unknown): value is TranslatedFunction {
  return (
    record(value) &&
    numbers(value, ["start", "end", "labelAddress"]) &&
    typeof value.exportName === "string" &&
    value.labels instanceof Int32Array
  );
}
function isStatistics(value: unknown): value is TranslationStatistics {
  return (
    record(value) &&
    numbers(value, ["functions", "instructions", "reachable", "blocks", "unsupported"]) &&
    Array.isArray(value.unsupportedExecutable)
  );
}
function isCached(value: unknown): value is CachedModule {
  if (
    !record(value) ||
    typeof value.job !== "string" ||
    !(value.reads instanceof Uint32Array) ||
    typeof value.digest !== "string"
  )
    return false;
  const translation = value.translation;
  return (
    record(translation) &&
    isWasm(translation.wasm) &&
    Array.isArray(translation.functions) &&
    translation.functions.every(isFunction) &&
    isStatistics(translation.statistics)
  );
}

/**
 * Reuses modules translated in earlier launches. Each job's slot holds one module per build; the job's inputs
 * and the guest bytes the translation read must still match, so changed batches and patched code translate again.
 */
export class ModuleCache {
  readonly #database: TranslationDatabase;
  readonly #prefix: string;
  readonly #ready: Promise<IDBDatabase | undefined>;
  constructor(database: TranslationDatabase, version: string) {
    this.#database = database;
    this.#prefix = version + VERSION_SEPARATOR;
    this.#ready = database
      .prune(version)
      .then(() => database.database())
      .catch(() => undefined);
  }
  async run(job: TranslationJob, word: ReadWord): Promise<JobResult> {
    const db = job.cacheKey === undefined ? undefined : await this.#ready;
    if (!db) return runJob(job, word);
    const began = performance.now(),
      key = this.#prefix + job.cacheKey + (job.shared ? SHARED_SLOT : ""),
      inputs = await sha256(new TextEncoder().encode(describe(job)));
    const stored = await this.#database
      .get(TranslationStore.Modules, key)
      .catch((): unknown => undefined);
    if (isCached(stored) && stored.job === inputs) {
      const values = readValues(stored.reads, word);
      if (values && (await sha256(values)) === stored.digest)
        return {
          translation: stored.translation,
          elapsedMs: performance.now() - began,
          cached: true,
        };
    }
    const reads = new Set<number>();
    const result = runJob(job, (address) => {
      reads.add(address);
      return word(address);
    });
    const ranges = readRanges(reads),
      values = readValues(ranges, word);
    if (values) {
      const module: CachedModule = {
        job: inputs,
        reads: ranges,
        digest: await sha256(values),
        translation: result.translation,
      };
      this.#database.put(db, TranslationStore.Modules, key, module).catch(() => undefined);
    }
    return { ...result, elapsedMs: performance.now() - began };
  }
}
