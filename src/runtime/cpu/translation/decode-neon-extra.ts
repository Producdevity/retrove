import { field, flag } from "./bits";
import type { SimdRegisters } from "./decode-neon";
import { AccessBytes, Condition, type Instruction } from "./instruction";

const cond = Condition.Unconditional;
const Encoding = {
  OrderMask: 0xfe800f00,
  Order: 0xf2000300,
  NotMask: 0xffbf0f90,
  Not: 0xf3b00580,
  ShiftLeftMask: 0xffa00f90,
  ShiftLeft: 0xf2a00510,
  SaturateNarrowMask: 0xffb30f10,
  SaturateNarrow: 0xf3b20200,
  ZeroCompareMask: 0xffb30c10,
  ZeroCompare: 0xf3b10000,
  FixedMask: 0xfe800e90,
  Fixed: 0xf2800e10,
  WidenAddMask: 0xfe800d50,
  WidenAdd: 0xf2800100,
} as const;
const ZERO_COMPARES = ["gt", "ge", "eq", "le", "lt"] as const;
const NARROW_BYTES = [AccessBytes.Byte, AccessBytes.Half] as const;
const Bit = { FixedToFloat: 8, Subtract: 9, Wide: 21 } as const;
const HALF_SIZE = 0b01;
const LANE_BITS = 64;
const Field = {
  Size: { shift: 20, width: 2 },
  ShiftAmount: { shift: 16, width: 5 },
  NarrowOp: { shift: 6, width: 2 },
  NarrowSize: { shift: 18, width: 2 },
  ZeroOp: { shift: 7, width: 3 },
  Imm6: { shift: 16, width: 6 },
} as const;
const WORD_SIZE = 0b10;
const GE_BIT = 4;
const NarrowOp = { SignedToUnsigned: 0b01, Signed: 0b10, Unsigned: 0b11 } as const;

const masked = (w: number, mask: number): number => (w & mask) >>> 0;

/** Integer compares, VMVN, VSHL (immediate) and saturating narrows on 32-bit lanes. */
export function decodeSimdExtra(
  w: number,
  { d, n, m, q }: SimdRegisters,
  u: boolean,
): Instruction | undefined {
  if (masked(w, Encoding.OrderMask) === Encoding.Order && field(w, Field.Size) === WORD_SIZE)
    return { cond, kind: "viorder", ge: flag(w, GE_BIT), unsigned: u, q, d, n, m };
  if (masked(w, Encoding.NotMask) === Encoding.Not) return { cond, kind: "vmvn", q, d, m };
  if (masked(w, Encoding.ShiftLeftMask) === Encoding.ShiftLeft)
    return { cond, kind: "vshli", amount: field(w, Field.ShiftAmount), q, d, m };
  if (masked(w, Encoding.SaturateNarrowMask) === Encoding.SaturateNarrow) {
    const op = field(w, Field.NarrowOp),
      bytes = NARROW_BYTES[field(w, Field.NarrowSize)];
    if (!bytes || (!op && bytes !== 1)) return undefined;
    const signedSource = op !== NarrowOp.Unsigned,
      signedResult = op === NarrowOp.Signed;
    return { cond, kind: "vqmovn", saturate: op !== 0, signedSource, signedResult, bytes, d, m };
  }
  return decodeShiftsAndCompares(w, { d, n, m, q }, u);
}

function decodeShiftsAndCompares(
  w: number,
  { d, n, m, q }: SimdRegisters,
  u: boolean,
): Instruction | undefined {
  if (
    masked(w, Encoding.ZeroCompareMask) === Encoding.ZeroCompare &&
    field(w, Field.NarrowSize) === WORD_SIZE
  ) {
    const op = ZERO_COMPARES[field(w, Field.ZeroOp)];
    return op && { cond, kind: "vizero", op, q, d, m };
  }
  const imm6 = field(w, Field.Imm6);
  if (masked(w, Encoding.FixedMask) === Encoding.Fixed && flag(w, Bit.Wide)) {
    const toFixed = flag(w, Bit.FixedToFloat);
    return { cond, kind: "vcvtfixed", toFixed, unsigned: u, fraction: LANE_BITS - imm6, q, d, m };
  }
  if (masked(w, Encoding.WidenAddMask) === Encoding.WidenAdd && field(w, Field.Size) === HALF_SIZE)
    return { cond, kind: "vaddw", sub: flag(w, Bit.Subtract), unsigned: u, d, n, m };
  return undefined;
}
