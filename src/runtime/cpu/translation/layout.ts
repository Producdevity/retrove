/** Translated-code state block. Guest address A is host byte `arena + (A & mask)`. */
export interface StateLayout {
  readonly registers: number;
  readonly flags: number;
  readonly fpFlags: number;
  readonly stopped: number;
  readonly exitPC: number;
  readonly fpscr: number;
  readonly budget: number;
  readonly stopCount: number;
  /** Thread pointer (TPIDRURO), read by `mrc p15, 0, rN, c13, c0, 3`. */
  readonly tls: number;
  /** Debug builds record the guest PC and address of each memory access here. */
  readonly debugPC: number;
  readonly debugAddress: number;
  /** Debug builds append (host address, previous word, guest PC) triples for each store while cursor < limit. */
  readonly logCursor: number;
  readonly logLimit: number;
  /** Guest PC of the last entry that had no label; the adapter retranslates its function with it as a root. */
  readonly missingLabel: number;
  /** Nested calls between translated functions on the current Wasm stack. */
  readonly depth: number;
  readonly vfp: number;
  readonly scratch: number;
  /** Host address of guest address 0. */
  readonly arena: number;
  /** Guest addresses are masked to the arena's span before every access. */
  readonly mask: number;
  readonly index: { readonly base: number; readonly start: number; readonly end: number };
  /** Open-addressed table of guest page number + 1 -> table slot + 1, for code pages outside the executable. */
  readonly foreign?: { readonly base: number; readonly slots: number };
}

const Offset = {
  Flags: 64,
  FpFlags: 80,
  Stopped: 96,
  ExitPC: 100,
  Fpscr: 104,
  Budget: 108,
  StopCount: 112,
  Tls: 116,
  DebugPC: 120,
  DebugAddress: 124,
  LogCursor: 128,
  LogLimit: 132,
  MissingLabel: 136,
  Depth: 140,
  Vfp: 256,
  Scratch: 512,
} as const;

export const StateBytes = 1024;
const MEBIBYTE = 0x10_0000;
/** Memarg offsets past a masked guest address (multi-word transfers) land in this tail of the span. */
export const ArenaSlack = 0x1_0000;
/** Largest main-executable code span with an index and label tables (64 MiB); BioShock's __text is 25 MB. */
export const MaxCodeBytes = 0x400_0000;
/** Index and label tables hold one i32 per code halfword. */
export const TableBytesPerCodeByte = 2;
const FOREIGN_LABEL_BYTES = 0x80_0000;
const STATE_ALIGNMENT = 64;
/**
 * Fixed offsets from the arena base of everything translated code addresses, so a module is
 * valid at any base: the guest span, the state block, the foreign table, the address index, the
 * executable's label tables (at `Labels + 2 * code offset`) and a bump area for other labels.
 */
export function arenaRegion(span: number, maxCode = MaxCodeBytes) {
  const state = Math.ceil((span + ArenaSlack) / STATE_ALIGNMENT) * STATE_ALIGNMENT;
  const foreign = state + PageBytes;
  const index = span + MEBIBYTE;
  const labels = index + TableBytesPerCodeByte * maxCode;
  const foreignLabels = labels + TableBytesPerCodeByte * maxCode;
  return {
    state,
    foreign,
    index,
    labels,
    foreignLabels,
    bytes: foreignLabels + FOREIGN_LABEL_BYTES,
  };
}
export type ArenaRegion = ReturnType<typeof arenaRegion>;
/**
 * The layout with every host address made relative to the arena (and the arena itself 0), which
 * is what jobs carry: modules then come out the same in every session and in a worker.
 */
export function relativeLayout(L: StateLayout): StateLayout {
  const shift = (address: number) => address - L.arena;
  const out: { -readonly [K in keyof StateLayout]: StateLayout[K] } = { ...L, arena: 0 };
  for (const key of ADDRESS_FIELDS) out[key] = shift(L[key]);
  out.index = { ...L.index, base: shift(L.index.base) };
  if (L.foreign) out.foreign = { ...L.foreign, base: shift(L.foreign.base) };
  return out;
}
const ADDRESS_FIELDS = [
  "registers",
  "flags",
  "fpFlags",
  "stopped",
  "exitPC",
  "fpscr",
  "budget",
  "stopCount",
  "tls",
  "debugPC",
  "debugAddress",
  "logCursor",
  "logLimit",
  "missingLabel",
  "depth",
  "vfp",
  "scratch",
] as const satisfies readonly (keyof StateLayout)[];
/** Offset from the arena base of an absolute host address in the layout. */
export const relative = (L: StateLayout, address: number): number => address - L.arena;
export const PageBits = 12;
export const PageBytes = 1 << PageBits;
/** Unwind: the call depth limit was reached; the runner continues at the returned PC with an empty stack. */
export const StopState = { Running: 0, Stopped: 1, Exit: 2, Budget: 3, Unwind: 4 } as const;

export function stateLayout(
  base: number,
  memory: { readonly arena: number; readonly mask: number },
  index: StateLayout["index"],
): StateLayout {
  return {
    registers: base,
    flags: base + Offset.Flags,
    fpFlags: base + Offset.FpFlags,
    stopped: base + Offset.Stopped,
    exitPC: base + Offset.ExitPC,
    fpscr: base + Offset.Fpscr,
    budget: base + Offset.Budget,
    stopCount: base + Offset.StopCount,
    tls: base + Offset.Tls,
    debugPC: base + Offset.DebugPC,
    debugAddress: base + Offset.DebugAddress,
    logCursor: base + Offset.LogCursor,
    logLimit: base + Offset.LogLimit,
    missingLabel: base + Offset.MissingLabel,
    depth: base + Offset.Depth,
    vfp: base + Offset.Vfp,
    scratch: base + Offset.Scratch,
    arena: memory.arena,
    mask: memory.mask,
    index,
  };
}
