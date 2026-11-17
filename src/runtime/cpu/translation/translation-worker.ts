import { CodeMemory, runJob } from "./translation-job";
import {
  TranslationMessage,
  isTranslationRequest,
  type TranslationResponse,
} from "./translation-protocol";

declare function postMessage(message: TranslationResponse, transfer: Transferable[]): void;

const memory = new CodeMemory();
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
      try {
        const result = runJob(request.job, (address) => memory.word(address));
        const transfer = new Set<ArrayBufferLike>([
          result.translation.wasm.buffer,
          ...result.translation.functions.map((translated) => translated.labels.buffer),
        ]);
        postMessage(
          { type: TranslationMessage.Done, id: request.id, result },
          [...transfer].filter((buffer) => buffer instanceof ArrayBuffer),
        );
      } catch (error) {
        postMessage(
          { type: TranslationMessage.Failed, id: request.id, message: String(error) },
          [],
        );
      }
  }
});
