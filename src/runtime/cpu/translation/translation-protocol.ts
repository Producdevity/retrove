import type { CodeSnapshot, JobResult, TranslationJob } from "./translation-job";

export const TranslationMessage = {
  Code: "code",
  Patch: "patch",
  Translate: "translate",
  Done: "done",
  Failed: "failed",
} as const;
export type TranslationRequest =
  | { readonly type: typeof TranslationMessage.Code; readonly snapshot: CodeSnapshot }
  | { readonly type: typeof TranslationMessage.Patch; readonly snapshot: CodeSnapshot }
  | {
      readonly type: typeof TranslationMessage.Translate;
      readonly id: number;
      readonly job: TranslationJob;
    };
export type TranslationResponse =
  | {
      readonly type: typeof TranslationMessage.Done;
      readonly id: number;
      readonly result: JobResult;
    }
  | {
      readonly type: typeof TranslationMessage.Failed;
      readonly id: number;
      readonly message: string;
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function snapshot(value: unknown): value is CodeSnapshot {
  return record(value) && typeof value.start === "number" && value.bytes instanceof Uint8Array;
}
export function isTranslationRequest(value: unknown): value is TranslationRequest {
  if (!record(value)) return false;
  if (value.type === TranslationMessage.Code || value.type === TranslationMessage.Patch)
    return snapshot(value.snapshot);
  return (
    value.type === TranslationMessage.Translate &&
    typeof value.id === "number" &&
    record(value.job) &&
    Array.isArray(value.job.functions) &&
    value.job.labels instanceof Map
  );
}
export function isTranslationResponse(value: unknown): value is TranslationResponse {
  if (!record(value) || typeof value.id !== "number") return false;
  if (value.type === TranslationMessage.Failed) return typeof value.message === "string";
  return (
    value.type === TranslationMessage.Done &&
    record(value.result) &&
    typeof value.result.elapsedMs === "number" &&
    typeof value.result.cached === "boolean" &&
    record(value.result.translation) &&
    value.result.translation.wasm instanceof Uint8Array &&
    Array.isArray(value.result.translation.functions)
  );
}
