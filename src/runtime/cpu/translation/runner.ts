import { StopState } from "./layout";
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
  /** Receives the guest PC (with the Thumb bit) as translated code moves it. */
  bridge: { pc: number },
  start: number,
  until: number,
  budget: number,
  /** Call depth of the frames already on this stack (a host call running guest code). */
  baseDepth = 0,
): TranslatedRun {
  const view = tier.pages.view,
    layout = tier.layout;
  view.setUint32(layout.stopped, StopState.Running, true);
  view.setUint32(layout.depth, baseDepth, true);
  view.setInt32(layout.budget, budget, true);
  let pc = start;
  bridge.pc = pc;
  for (let entry = tier.enter(pc); entry; entry = tier.enter(pc)) {
    const entered = pc,
      run: unknown = tier.table.get(entry - 1);
    if (!translatedEntry(run)) throw new Error("Translated function table entry is not callable.");
    pc = run(pc) >>> 0;
    bridge.pc = pc;
    const stopped = tier.pages.view.getUint32(layout.stopped, true);
    if (stopped === StopState.Budget) return { reason: "budget", pc };
    if (stopped === StopState.Unwind) {
      tier.pages.view.setUint32(layout.stopped, StopState.Running, true);
      tier.statistics.stackUnwinds++;
    }
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
