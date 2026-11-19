import { StopState, type StateLayout } from "../translation/layout";
import type { WorkerCode } from "./worker-code";

type TranslatedEntry = (pc: number) => number;
function translatedEntry(value: unknown): value is TranslatedEntry {
  return typeof value === "function";
}
export type WorkerSlice =
  | { readonly reason: "budget" | "until"; readonly pc: number }
  | { readonly reason: "fallback"; readonly pc: number; readonly missing: boolean };

/**
 * `runTranslated` for a worker's table: runs translated functions until the budget expires,
 * `until` is reached, or execution reaches code this worker has no instance for. `missing`
 * reports an entry whose function has no label for it, which the main thread retranslates.
 */
export function runWorkerSlice(
  code: WorkerCode,
  view: DataView,
  L: StateLayout,
  start: number,
  until: number,
  budget: number,
): WorkerSlice {
  view.setUint32(L.stopped, StopState.Running, true);
  view.setUint32(L.depth, 0, true);
  view.setInt32(L.budget, budget, true);
  let pc = start,
    missing = false;
  for (let entry = code.entry(pc); entry && code.has(entry - 1); entry = code.entry(pc)) {
    const entered = pc,
      run: unknown = code.table.get(entry - 1);
    if (!translatedEntry(run)) throw new Error("Translated function table entry is not callable.");
    pc = run(pc) >>> 0;
    const stopped = view.getUint32(L.stopped, true);
    if (stopped === StopState.Budget) return { reason: "budget", pc };
    if (stopped === StopState.Unwind) view.setUint32(L.stopped, StopState.Running, true);
    if (stopped === StopState.Exit) {
      missing = pc === entered || view.getUint32(L.missingLabel, true) === pc;
      view.setUint32(L.missingLabel, 0, true);
      break;
    }
    if (pc === until) return { reason: "until", pc };
  }
  return pc === until ? { reason: "until", pc } : { reason: "fallback", pc, missing };
}
