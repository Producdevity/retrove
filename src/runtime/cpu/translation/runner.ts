import { StopState } from "./layout";
import type { RegisterBridge } from "./register-bridge";
import type { TranslatedTier } from "./tier";

type TranslatedEntry = (pc: number) => number;
export type TranslatedRun =
  | { readonly reason: "budget" | "until"; readonly pc: number }
  | { readonly reason: "fallback"; readonly pc: number };
function translatedEntry(value: unknown): value is TranslatedEntry {
  return typeof value === "function";
}
/**
 * Runs translated functions until the budget expires, `until` is reached, or execution leaves
 * translated code. A missing label means an entry the translation did not know; its function is
 * retranslated with that entry.
 */
export function runTranslated(
  tier: TranslatedTier,
  bridge: RegisterBridge,
  start: number,
  until: number,
  budget: number,
): TranslatedRun {
  tier.resetStop(budget);
  let pc = start;
  bridge.pc = pc;
  for (let entry = tier.entry(pc); entry; entry = tier.entry(pc)) {
    const entered = pc,
      run: unknown = tier.table.get(entry - 1);
    if (!translatedEntry(run)) throw new Error("Translated function table entry is not callable.");
    pc = run(pc) >>> 0;
    bridge.pc = pc;
    const stopped = tier.stopped();
    if (stopped === StopState.Budget) return { reason: "budget", pc };
    if (stopped === StopState.Exit) {
      const view = tier.pages.view,
        missing = tier.layout.missingLabel;
      if (pc === entered || view.getUint32(missing, true) === pc) tier.discoveredEntry(pc);
      view.setUint32(missing, 0, true);
      break;
    }
    if (pc === until) return { reason: "until", pc };
  }
  return pc === until ? { reason: "until", pc } : { reason: "fallback", pc };
}
