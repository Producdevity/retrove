const ERROR_TEXT = 400;
export interface TierStatistics {
  translatedFunctions: number;
  pendingFunctions: number;
  batches: number;
  translateMs: number;
  compileMs: number;
  wasmBytes: number;
  foreignPages: number;
  unsupported: number;
  invalidations: number;
  retranslations: number;
  errors: number;
  lastError: string;
  translator: string;
}
export function emptyStatistics(): TierStatistics {
  return {
    translatedFunctions: 0,
    pendingFunctions: 0,
    batches: 0,
    translateMs: 0,
    compileMs: 0,
    wasmBytes: 0,
    foreignPages: 0,
    unsupported: 0,
    invalidations: 0,
    retranslations: 0,
    errors: 0,
    lastError: "",
    translator: "",
  };
}
export function recordError(statistics: TierStatistics, error: unknown): void {
  statistics.errors++;
  statistics.lastError = String(error instanceof Error ? error.stack : error).slice(0, ERROR_TEXT);
}
