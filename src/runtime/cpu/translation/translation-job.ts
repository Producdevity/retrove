import { TableBytesPerCodeByte, type StateLayout } from "./layout";
import { translate } from "./translate";
import type { FunctionRange, Translation } from "./translation-types";

const WORD_BYTES = 4;
const THUMB_BIT = 1;
const LABEL_ALIGNMENT = 16;
/** A copy of guest bytes starting at a guest address. */
export interface CodeSnapshot {
  readonly start: number;
  readonly bytes: Uint8Array;
}
/** Everything `translate` needs, as plain data that can cross a worker boundary. */
export interface TranslationJob {
  readonly functions: readonly FunctionRange[];
  readonly entries: readonly number[];
  readonly layout: StateLayout;
  readonly stopPC: number;
  /** Function start -> offset of its label table in the module's own label block. */
  readonly labels: ReadonlyMap<number, number>;
  /** Literal pools are folded only inside this range (the main executable's code). */
  readonly code: { readonly start: number; readonly end: number } | undefined;
  /** Bytes that are only valid for this job (code pages outside the main executable). */
  readonly pages: readonly CodeSnapshot[];
  /** Slot for this job's module in the worker's cache; replayed batches reuse their slot every launch. */
  readonly cacheKey: string | undefined;
  /** Emit for a shared memory (atomic exclusives, shared memory import); see `module`. */
  readonly shared: boolean;
}
export interface JobResult {
  readonly translation: Translation;
  readonly elapsedMs: number;
  readonly cached: boolean;
}
/** Guest code bytes for word reads; later snapshots and patches replace earlier bytes. */
export class CodeMemory {
  readonly #snapshots: CodeSnapshot[] = [];
  #views = new WeakMap<Uint8Array, DataView>();
  add(snapshot: CodeSnapshot): void {
    this.#snapshots.unshift(snapshot);
  }
  /** Overwrites bytes inside existing snapshots; bytes outside every snapshot are ignored. */
  patch(start: number, bytes: Uint8Array): void {
    for (const snapshot of this.#snapshots) {
      const from = Math.max(start, snapshot.start),
        to = Math.min(start + bytes.length, snapshot.start + snapshot.bytes.length);
      if (from < to)
        snapshot.bytes.set(bytes.subarray(from - start, to - start), from - snapshot.start);
    }
  }
  word(address: number): number | undefined {
    for (const snapshot of this.#snapshots) {
      const offset = address - snapshot.start;
      if (offset < 0 || offset + WORD_BYTES > snapshot.bytes.length) continue;
      let view = this.#views.get(snapshot.bytes);
      if (!view) {
        view = new DataView(
          snapshot.bytes.buffer,
          snapshot.bytes.byteOffset,
          snapshot.bytes.byteLength,
        );
        this.#views.set(snapshot.bytes, view);
      }
      return view.getUint32(offset, true);
    }
    return undefined;
  }
}
export function runJob(
  job: TranslationJob,
  readWord: (address: number) => number | undefined,
): JobResult {
  const began = performance.now(),
    local = new CodeMemory();
  for (const page of job.pages) local.add(page);
  const code = job.code;
  const translation = translate({
    functions: job.functions,
    readWord: (address) => local.word(address) ?? readWord(address),
    isCode: (address) => !!code && address >= code.start && address < code.end,
    entries: job.entries,
    stopPC: job.stopPC,
    layout: job.layout,
    shared: job.shared,
    labelAddress: (range) => {
      const address = job.labels.get(range.start);
      if (address === undefined) throw new Error("Missing label table for a translated function.");
      return address;
    },
  });
  return { translation, elapsedMs: performance.now() - began, cached: false };
}
/**
 * Builds a job with each function's label table (an i32 per halfword) laid out in one block per
 * module. A function can be live in several modules at once, so tables are never shared.
 */
export function buildJob(input: Omit<TranslationJob, "labels">): TranslationJob {
  const labels = new Map<number, number>();
  let next = 0;
  for (const range of input.functions) {
    labels.set(range.start, next);
    next += alignLabels(TableBytesPerCodeByte * (range.end - (range.start & ~THUMB_BIT)));
  }
  return { ...input, labels };
}
const alignLabels = (bytes: number) => Math.ceil(bytes / LABEL_ALIGNMENT) * LABEL_ALIGNMENT;
/** Bytes of label block a translation needs. */
export function labelBlockBytes(translation: Translation): number {
  let end = 0;
  for (const translated of translation.functions)
    end = Math.max(end, translated.labelAddress + translated.labels.byteLength);
  return alignLabels(end);
}
