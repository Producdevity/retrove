import type { StateLayout } from "./layout";

export interface FunctionRange {
  readonly start: number;
  readonly end: number;
}

export interface TranslationInput {
  readonly functions: readonly FunctionRange[];
  readonly readWord: (address: number) => number | undefined;
  readonly isCode: (address: number) => boolean;
  readonly entries: readonly number[];
  readonly stopPC: number;
  readonly layout: StateLayout;
  /** Returns the host address of a label table with one i32 per instruction slot of `range`. */
  readonly labelAddress: (range: FunctionRange) => number;
  /** Records the PC and address of every memory access (slow; for locating faults). */
  readonly debug?: boolean;
  /** Code runs on a shared memory: exclusives and barriers become Wasm atomics. */
  readonly shared?: boolean;
}

export interface TranslatedFunction extends FunctionRange {
  readonly exportName: string;
  readonly labelAddress: number;
  readonly labels: Int32Array;
}

export interface TranslationStatistics {
  readonly functions: number;
  readonly instructions: number;
  readonly reachable: number;
  readonly blocks: number;
  readonly unsupported: number;
  readonly unsupportedExecutable: readonly number[];
}

export interface Translation {
  readonly wasm: Uint8Array<ArrayBuffer>;
  readonly functions: readonly TranslatedFunction[];
  readonly statistics: TranslationStatistics;
}
