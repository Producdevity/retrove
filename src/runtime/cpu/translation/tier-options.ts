import type { HostHeap } from "./guest-pages";
import type { TranslationProfile } from "./translation-profile";

export interface TierModule extends HostHeap {
  getTciMemory(): WebAssembly.Memory;
}
export interface TierOptions {
  /** Functions translated in earlier launches; replayed in large batches when the executable is found. */
  readonly profile?: TranslationProfile | undefined;
  readonly onProfile?: ((profile: TranslationProfile) => void) | undefined;
  /** The app's key for its modules in the worker's cache; without it nothing is cached. */
  readonly cache?: string | undefined;
  /** Live translated code before a flush; set from the device budget. */
  readonly codeBudget?: number | undefined;
  /** Prepares ahead-of-time chunks in the background; off for callers that never load them. */
  readonly ahead?: boolean | undefined;
}

export const Alignment = { State: 64, Table: 4096, Index: 16 } as const;
export const Batch = { instructions: 60_000, functions: 400 } as const;
/** Measured on BioShock: translated modules average about 55 bytes of Wasm per ARM instruction. */
const WASM_BYTES_PER_INSTRUCTION = 55;
const REPLAY_SHARE_OF_BUDGET = 0.5;
/** Earlier launches' functions replayed at startup, kept to half the code budget so replay never flushes. */
export const replayLimits = (codeBudget: number) =>
  ({
    ...Batch,
    total: Math.floor((codeBudget * REPLAY_SHARE_OF_BUDGET) / WASM_BYTES_PER_INSTRUCTION),
  }) as const;
/** A short wait lets functions noted close together share one module. */
export const Coalesce = { Functions: 32, DelayMs: 30 } as const;
export const PROFILE_SAVE_MS = 5000;
/** The emitted code exits to this PC when it stops; it is never a valid guest instruction address. */
export const STOP_PC = 1;
