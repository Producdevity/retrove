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
}

export const Alignment = { State: 64, Table: 4096, Index: 16 } as const;
export const Batch = { instructions: 60_000, functions: 400 } as const;
/** A short wait lets functions noted close together share one module. */
export const Coalesce = { Functions: 32, DelayMs: 30 } as const;
export const PROFILE_SAVE_MS = 5000;
/** The emitted code exits to this PC when it stops; it is never a valid guest instruction address. */
export const STOP_PC = 1;
