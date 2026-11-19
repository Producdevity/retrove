const WORD_BYTES = 4;
const HALFWORD_BYTES = 2;
const THUMB_BIT = 1;
const Arm = {
  BranchLinkMask: 0x0f00_0000,
  BranchLink: 0x0b00_0000,
  Unconditional: 0xf000_0000,
  ExchangeMask: 0xfe00_0000,
  BranchLinkExchange: 0xfa00_0000,
  HalfwordBit: 0x0100_0000,
  ImmediateMask: 0x00ff_ffff,
  ImmediateSign: 0x0080_0000,
  ImmediateRange: 0x0100_0000,
  PcAhead: 8,
  /** STMFD sp!, {..., lr} */
  PushMask: 0xffff_4000,
  Push: 0xe92d_4000,
} as const;
const Thumb = {
  PrefixMask: 0xf800,
  Prefix: 0xf000,
  BranchLink: 0xf800,
  BranchLinkExchange: 0xe800,
  OffsetMask: 0x07ff,
  HighShift: 12,
  LowShift: 1,
  SignBit: 0x0040_0000,
  Range: 0x0080_0000,
  PcAhead: 4,
  /** PUSH {..., lr} */
  PushMask: 0xff00,
  Push: 0xb500,
} as const;
/** A target called at least this often is a function even without a recognised prologue. */
const MIN_CALLERS = 2;
const IMMEDIATE_SCALE = 4;

function count(targets: Map<number, number>, target: number): void {
  targets.set(target, (targets.get(target) ?? 0) + 1);
}
function armTargets(bytes: DataView, base: number, targets: Map<number, number>): void {
  for (let at = 0; at + WORD_BYTES <= bytes.byteLength; at += WORD_BYTES) {
    const word = bytes.getUint32(at, true),
      pc = base + at;
    const exchange = (word & Arm.ExchangeMask) >>> 0 === Arm.BranchLinkExchange;
    const link =
      (word & Arm.BranchLinkMask) === Arm.BranchLink &&
      (word & Arm.Unconditional) >>> 0 !== Arm.Unconditional;
    if (!exchange && !link) continue;
    let offset = word & Arm.ImmediateMask;
    if (offset & Arm.ImmediateSign) offset -= Arm.ImmediateRange;
    const target = pc + Arm.PcAhead + offset * IMMEDIATE_SCALE;
    if (exchange)
      count(targets, (target + (word & Arm.HalfwordBit ? HALFWORD_BYTES : 0)) | THUMB_BIT);
    else count(targets, target);
  }
}
function thumbTargets(bytes: DataView, base: number, targets: Map<number, number>): void {
  for (let at = 0; at + WORD_BYTES <= bytes.byteLength; at += HALFWORD_BYTES) {
    const first = bytes.getUint16(at, true),
      second = bytes.getUint16(at + HALFWORD_BYTES, true);
    if ((first & Thumb.PrefixMask) !== Thumb.Prefix) continue;
    const kind = second & Thumb.PrefixMask;
    if (kind !== Thumb.BranchLink && kind !== Thumb.BranchLinkExchange) continue;
    let offset =
      ((first & Thumb.OffsetMask) << Thumb.HighShift) |
      ((second & Thumb.OffsetMask) << Thumb.LowShift);
    if (offset & Thumb.SignBit) offset -= Thumb.Range;
    const target = base + at + Thumb.PcAhead + offset;
    if (kind === Thumb.BranchLink) count(targets, target | THUMB_BIT);
    else count(targets, target & ~(WORD_BYTES - 1));
  }
}
function prologue(bytes: DataView, offset: number, thumb: boolean): boolean {
  if (thumb)
    return (
      offset + HALFWORD_BYTES <= bytes.byteLength &&
      (bytes.getUint16(offset, true) & Thumb.PushMask) === Thumb.Push
    );
  return (
    offset + WORD_BYTES <= bytes.byteLength &&
    (bytes.getUint32(offset, true) & Arm.PushMask) >>> 0 === Arm.Push
  );
}

/**
 * Function starts for executables without LC_FUNCTION_STARTS (iOS 3 era builds, often stripped):
 * targets of direct calls in both instruction sets, kept when called repeatedly or when they
 * begin with a push of the link register. Missed functions stay inside the previous range and
 * are reached through entry labels.
 */
export function callTargets(code: Uint8Array, base: number): number[] {
  const bytes = new DataView(code.buffer, code.byteOffset, code.byteLength),
    targets = new Map<number, number>();
  armTargets(bytes, base, targets);
  thumbTargets(bytes, base, targets);
  const starts: number[] = [];
  for (const [target, callers] of targets) {
    const offset = (target & ~THUMB_BIT) - base,
      thumb = (target & THUMB_BIT) !== 0;
    if (offset < 0 || offset >= code.length) continue;
    if (callers >= MIN_CALLERS || prologue(bytes, offset, thumb)) starts.push(target);
  }
  return starts.sort((a, b) => (a & ~THUMB_BIT) - (b & ~THUMB_BIT));
}
