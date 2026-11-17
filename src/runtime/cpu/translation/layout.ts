/** Translated-code state block. Guest memory is reached through a page table of host-minus-guest deltas. */
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
  readonly vfp: number;
  readonly scratch: number;
  readonly pageTable: number;
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
  Vfp: 256,
  Scratch: 512,
} as const;
const AddressSpaceBytes = 0x100000000;
const PageTableEntryBytes = 4;
const LastPage = 0xfffff000;

export const StateBytes = 1024;
export const PageBits = 12;
export const PageBytes = 1 << PageBits;
export const PageTableBytes = (AddressSpaceBytes / PageBytes) * PageTableEntryBytes;
/** Accesses add this memarg offset, so an unmapped page's delta pushes the effective address past 2^32 and traps. */
export const Guard = 0x1000;
export const UnmappedDelta = (guestPage: number) => (LastPage - guestPage) | 0;
export const MappedDelta = (guestPage: number, hostPage: number) =>
  (hostPage - guestPage - Guard) | 0;
export const StopState = { Running: 0, Stopped: 1, Exit: 2, Budget: 3 } as const;

export function stateLayout(
  base: number,
  pageTable: number,
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
    vfp: base + Offset.Vfp,
    scratch: base + Offset.Scratch,
    pageTable,
    index,
  };
}
