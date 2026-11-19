import type { CodeSnapshot, JobResult, TranslationJob } from "./translation-job";
import {
  TranslationMessage,
  isTranslationResponse,
  type TranslationRequest,
} from "./translation-protocol";
import { translationWorkerEnabled } from "./settings";

interface Pending {
  readonly job: TranslationJob;
  resolve(result: JobResult): void;
  reject(error: Error): void;
}
export const TranslatorKind = { Worker: "worker", Inline: "inline" } as const;
export type TranslatorKind = (typeof TranslatorKind)[keyof typeof TranslatorKind];
function startWorker(): Worker | undefined {
  if (typeof Worker === "undefined" || !translationWorkerEnabled()) return undefined;
  try {
    return new Worker(new URL("./translation-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return undefined;
  }
}
/**
 * Runs translation jobs on a worker so the guest keeps running on the main thread. The worker keeps
 * its own copy of the main executable's code; without a worker (or after it fails) jobs run inline
 * against live guest memory.
 */
export class Translator {
  #worker: Worker | undefined;
  readonly #inline: (job: TranslationJob) => JobResult;
  readonly #pending = new Map<number, Pending>();
  readonly #preparing = new Map<number, (cached: boolean) => void>();
  #next = 0;
  constructor(inline: (job: TranslationJob) => JobResult) {
    this.#inline = inline;
    this.#worker = startWorker();
    this.#worker?.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.#receive(event.data);
    });
    this.#worker?.addEventListener("error", () => {
      this.#fallBack();
    });
  }
  get kind(): TranslatorKind {
    return this.#worker ? TranslatorKind.Worker : TranslatorKind.Inline;
  }
  #post(request: TranslationRequest, transfer: Transferable[] = []): void {
    this.#worker?.postMessage(request, transfer);
  }
  #receive(message: unknown): void {
    if (!isTranslationResponse(message)) return;
    const prepared = this.#preparing.get(message.id);
    if (prepared) {
      this.#preparing.delete(message.id);
      prepared(message.type === TranslationMessage.Prepared && message.cached);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.type === TranslationMessage.Done) pending.resolve(message.result);
    else if (message.type === TranslationMessage.Failed) pending.reject(new Error(message.message));
  }
  /** Moves pending jobs to the inline translator when the worker cannot run. */
  #fallBack(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const prepared of this.#preparing.values()) prepared(false);
    this.#preparing.clear();
    for (const job of pending) this.#runInline(job);
  }
  #runInline(pending: Pending): void {
    try {
      pending.resolve(this.#inline(pending.job));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  /** Gives the worker its copy of executable code; the snapshot buffer is transferred. */
  setCode(snapshot: CodeSnapshot): void {
    this.#post({ type: TranslationMessage.Code, snapshot }, [snapshot.bytes.buffer]);
  }
  /** Updates the worker's copy after guest code was written. */
  patch(snapshot: CodeSnapshot): void {
    this.#post({ type: TranslationMessage.Patch, snapshot });
  }
  translate(job: TranslationJob): Promise<JobResult> {
    return new Promise((resolve, reject) => {
      const pending = { job, resolve, reject };
      if (!this.#worker) {
        this.#runInline(pending);
        return;
      }
      const id = ++this.#next;
      this.#pending.set(id, pending);
      this.#post({ type: TranslationMessage.Translate, id, job });
    });
  }
  /** Translates a job into the worker's cache; false without a worker or cache. */
  prepare(job: TranslationJob): Promise<boolean> {
    const worker = this.#worker;
    if (!worker) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = ++this.#next;
      this.#preparing.set(id, resolve);
      this.#post({ type: TranslationMessage.Prepare, id, job });
    });
  }
  close(): void {
    for (const prepared of this.#preparing.values()) prepared(false);
    this.#preparing.clear();
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const pending of this.#pending.values()) pending.reject(new Error("Translator closed."));
    this.#pending.clear();
  }
}
