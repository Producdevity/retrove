import type { StateLayout } from "./layout";
import { translate } from "./translate";
import type { FunctionRange, Translation } from "./translation-types";

const WORD_BYTES = 4;
const LABEL_BYTES_PER_HALFWORD = 2;
const THUMB_BIT = 1;
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
  /** Function start -> host address of its label table, allocated by the caller. */
  readonly labels: ReadonlyMap<number, number>;
  /** Literal pools are folded only inside this range (the main executable's code). */
  readonly code: { readonly start: number; readonly end: number } | undefined;
  /** Bytes that are only valid for this job (code pages outside the main executable). */
  readonly pages: readonly CodeSnapshot[];
}
export interface JobResult {
  readonly translation: Translation;
  readonly elapsedMs: number;
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
    labelAddress: (range) => {
      const address = job.labels.get(range.start);
      if (address === undefined) throw new Error("Missing label table for a translated function.");
      return address;
    },
  });
  return { translation, elapsedMs: performance.now() - began };
}
/** Builds a job, allocating one label table (an i32 per halfword) for each function. */
export function buildJob(
  input: Omit<TranslationJob, "labels"> & { readonly allocate: (bytes: number) => number },
): TranslationJob {
  const labels = new Map<number, number>();
  for (const range of input.functions)
    labels.set(
      range.start,
      input.allocate(LABEL_BYTES_PER_HALFWORD * (range.end - (range.start & ~THUMB_BIT))),
    );
  const { allocate: _allocate, ...job } = input;
  return { ...job, labels };
}
