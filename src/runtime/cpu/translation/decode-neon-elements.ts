import { field, flag } from "./bits";
import type { SimdRegisters } from "./decode-neon";
import { Condition, type Instruction } from "./instruction";
import { ElementSize as Element, type ElementBits } from "./vector-instruction";

const cond = Condition.Unconditional;
const Field = {
  A: { shift: 8, width: 4 },
  Size: { shift: 20, width: 2 },
  Imm6: { shift: 16, width: 6 },
} as const;
const Bit = { B: 4, Up: 23, Long: 7 } as const;
const SAME_PREFIX = 0x79;
const PREFIX_SHIFT = 25;
const Same = { AddSub: 0b1000, MulAcc: 0b1001, ShiftRegister: 0b0100 } as const;
const Shift = { Right: 0b0000, RightAccumulate: 0b0001, Left: 0b0101, Narrow: 0b1000 } as const;
const ROUND_BIT = 6;
const ELEMENT_BITS = [Element.Byte, Element.Half, Element.Word, Element.Double] as const;
const DOUBLE_SIZE = 3;
/** Shift-by-immediate encodings with imm6 below this and L clear are the modified-immediate space. */
const SHIFT_IMM6_MINIMUM = 8;
const WORD_SIZE = 2;
/** Right shifts encode `2 * esize - amount` (64-bit elements: `64 - amount`). */
const SHIFT_RANGE = 2;

/** Element size implied by imm6/L in a shift-by-immediate encoding. */
function shiftElement(imm6: number, long: boolean): ElementBits {
  if (long) return Element.Double;
  return imm6 >= Element.Word ? Element.Word : imm6 >= Element.Half ? Element.Half : Element.Byte;
}

/** Integer arithmetic and shifts on 8/16-bit (and some 64-bit) elements, element by element. */
export function decodeSimdElements(
  w: number,
  { d, n, m, q }: SimdRegisters,
  u: boolean,
): Instruction | undefined {
  if (w >>> PREFIX_SHIFT !== SAME_PREFIX) return undefined;
  const a = field(w, Field.A),
    b = flag(w, Bit.B);
  if (!flag(w, Bit.Up)) {
    const size = field(w, Field.Size),
      bits = ELEMENT_BITS[size] ?? Element.Double;
    if (a === Same.AddSub && !b && size < WORD_SIZE)
      return { cond, kind: "velem", op: u ? "sub" : "add", bits, q, d, n, m };
    if (a === Same.MulAcc && size <= WORD_SIZE && !(b && u))
      return { cond, kind: "velem", op: b ? "mul" : u ? "mls" : "mla", bits, q, d, n, m };
    if (a === Same.ShiftRegister && !b && size === DOUBLE_SIZE)
      return { cond, kind: "vshlreg64", unsigned: u, q, d, n, m };
    return undefined;
  }
  if (!b) return undefined;
  const imm6 = field(w, Field.Imm6),
    long = flag(w, Bit.Long);
  if (!long && imm6 < SHIFT_IMM6_MINIMUM) return undefined;
  const bits = shiftElement(imm6, long),
    right = (long ? bits : SHIFT_RANGE * bits) - imm6;
  if (a === Shift.Right || a === Shift.RightAccumulate) {
    const op = a === Shift.Right ? "shr" : "sra";
    return { cond, kind: "veshift", op, unsigned: u, bits, amount: right, q, d, m };
  }
  if (a === Shift.Narrow && !u && !long && bits !== Element.Word)
    return { cond, kind: "vshrn", round: flag(w, ROUND_BIT), bits, amount: right, d, m };
  if (a === Shift.Left && !u) {
    const amount = imm6 - (long ? 0 : bits);
    return { cond, kind: "veshift", op: "shl", unsigned: false, bits, amount, q, d, m };
  }
  return undefined;
}
