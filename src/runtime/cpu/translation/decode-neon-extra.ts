import { field, flag } from "./bits";
import type { SimdRegisters } from "./decode-neon";
import { Condition, type Instruction } from "./instruction";

const cond = Condition.Unconditional;
const Encoding = {
  OrderMask: 0xfe800f00,
  Order: 0xf2000300,
  NotMask: 0xffbf0f90,
  Not: 0xf3b00580,
  ShiftLeftMask: 0xffa00f90,
  ShiftLeft: 0xf2a00510,
  SaturateNarrowMask: 0xffbf0f10,
  SaturateNarrow: 0xf3b60200,
} as const;
const Field = {
  Size: { shift: 20, width: 2 },
  ShiftAmount: { shift: 16, width: 5 },
  NarrowOp: { shift: 6, width: 2 },
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
    const op = field(w, Field.NarrowOp);
    if (!op) return undefined;
    const signedSource = op !== NarrowOp.Unsigned,
      signedResult = op === NarrowOp.Signed;
    return { cond, kind: "vqmovn", signedSource, signedResult, d, m };
  }
  return undefined;
}
