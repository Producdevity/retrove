import { ModuleCache } from "./module-cache";
import { CodeMemory, runJob, type TranslationJob } from "./translation-job";
import {
  TranslationMessage,
  isTranslationRequest,
  type TranslationResponse,
} from "./translation-protocol";
import { translationDatabase } from "./translation-store";

declare function postMessage(message: TranslationResponse, transfer: Transferable[]): void;

const memory = new CodeMemory();
const word = (address: number): number | undefined => memory.word(address);
/** Development builds change translator code without changing this module's URL, so they skip the cache. */
const database = import.meta.env.DEV ? undefined : translationDatabase();
const cache = database && new ModuleCache(database, new URL(import.meta.url).pathname);

async function translate(id: number, job: TranslationJob): Promise<void> {
  try {
    const result = cache ? await cache.run(job, word) : runJob(job, word);
    const transfer = new Set<ArrayBufferLike>([
      result.translation.wasm.buffer,
      ...result.translation.functions.map((translated) => translated.labels.buffer),
    ]);
    postMessage(
      { type: TranslationMessage.Done, id, result },
      [...transfer].filter((buffer) => buffer instanceof ArrayBuffer),
    );
  } catch (error) {
    postMessage({ type: TranslationMessage.Failed, id, message: String(error) }, []);
  }
}
/** Fills the cache for an ahead-of-time chunk; the module stays in the worker. */
async function prepare(id: number, job: TranslationJob): Promise<void> {
  try {
    if (cache) await cache.run(job, word);
    postMessage({ type: TranslationMessage.Prepared, id, cached: Boolean(cache) }, []);
  } catch (error) {
    postMessage({ type: TranslationMessage.Failed, id, message: String(error) }, []);
  }
}
addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isTranslationRequest(request)) return;
  switch (request.type) {
    case TranslationMessage.Code:
      memory.add(request.snapshot);
      return;
    case TranslationMessage.Patch:
      memory.patch(request.snapshot.start, request.snapshot.bytes);
      return;
    case TranslationMessage.Translate:
      void translate(request.id, request.job);
      return;
    case TranslationMessage.Prepare:
      void prepare(request.id, request.job);
  }
});
