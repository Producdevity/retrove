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
  const view = tier.pages.view,
    layout = tier.layout;
  view.setUint32(layout.stopped, StopState.Running, true);
  view.setInt32(layout.budget, budget, true);
  let pc = start;
  bridge.pc = pc;
  for (let entry = tier.entry(pc); entry; entry = tier.entry(pc)) {
    const entered = pc,
      run: unknown = tier.table.get(entry - 1);
    if (!translatedEntry(run)) throw new Error("Translated function table entry is not callable.");
    pc = run(pc) >>> 0;
    bridge.pc = pc;
    const stopped = tier.pages.view.getUint32(layout.stopped, true);
    if (stopped === StopState.Budget) return { reason: "budget", pc };
    if (stopped === StopState.Exit) {
      const missing = layout.missingLabel;
      if (pc === entered || tier.pages.view.getUint32(missing, true) === pc)
        tier.discoveredEntry(pc);
      tier.pages.view.setUint32(missing, 0, true);
      break;
    }
    if (pc === until) return { reason: "until", pc };
  }
  return pc === until ? { reason: "until", pc } : { reason: "fallback", pc };
}
