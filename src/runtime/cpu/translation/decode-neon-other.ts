import { field, flag } from "./bits";
import { ArmBit, ArmField } from "./decode-fields";
import type { SimdRegisters } from "./decode-neon";
import { Condition, unsupported, type Instruction } from "./instruction";
import type { LaneBytes } from "./vector-instruction";

const cond = Condition.Unconditional;
const Encoding = {
  ExtractMask: 0xffb00010,
  Extract: 0xf2b00000,
  ReverseMask: 0xffbf0f90,
  Reverse: 0xf3b80000,
  CompareMask: 0xfe800f10,
  Compare: 0xf2000e00,
  CompareZeroMask: 0xffbf0c10,
  CompareZero: 0xf3b90400,
  EstimateMask: 0xffbf0e10,
  Estimate: 0xf3bb0400,
  NarrowMask: 0xffb30fd0,
  Narrow: 0xf3b20200,
  AddMask: 0xfe800f10,
  Add: 0xf2000800,
  ZipMask: 0xffb30f10,
  Zip: 0xf3b20100,
  PairAddMask: 0xff800f10,
  PairAdd: 0xf2000b10,
  StepMask: 0xff900f10,
  Step: 0xf2000f10,
  TransposeMask: 0xffb30f90,
  Transpose: 0xf3b20080,
  DuplicateMask: 0xffb00f90,
  Duplicate: 0xf3b00c00,
} as const;
const Field = {
  Imm4: { shift: 8, width: 4 },
  ZeroOp: { shift: 7, width: 3 },
  Size: { shift: 20, width: 2 },
  Imm4High: { shift: 16, width: 4 },
} as const;
const Size = { Half: 1, Word: 2, Double: 3 } as const;
const IntegerWord = 0b10;
const Bit = { Float: 8, Sqrt: 7, Unzip: 7, Step: 21 } as const;
const ElementBytes: Partial<Record<number, LaneBytes>> = { 0: 1, 1: 2, 2: 4 };
const ZeroCompares = ["gt", "ge", "eq", "le", "lt"] as const;
const Scalar = { Byte: 1, Half: 2, Word: 4, ByteShift: 1, HalfShift: 2, WordShift: 3 } as const;

const masked = (w: number, mask: number): number => (w & mask) >>> 0;

/** Remaining Advanced SIMD forms, in encoding-precedence order. */
export function decodeSimdOther(w: number, r: SimdRegisters, u: boolean): Instruction | undefined {
  const { d, n, m, q } = r;
  if (masked(w, Encoding.ExtractMask) === Encoding.Extract)
    return { cond, kind: "vext", q, d, n, m, imm: field(w, Field.Imm4) };
  if (masked(w, Encoding.ReverseMask) === Encoding.Reverse)
    return { cond, kind: "vrev64", q, d, m };
  if (masked(w, Encoding.CompareMask) === Encoding.Compare && !flag(w, ArmBit.S)) {
    const high = flag(w, ArmBit.Writeback);
    const op = !u ? (high ? undefined : "eq") : high ? "gt" : "ge";
    return op ? { cond, kind: "vfcmp", op, zero: false, q, d, n, m } : unsupported(cond);
  }
  if (masked(w, Encoding.CompareZeroMask) === Encoding.CompareZero) {
    const op = ZeroCompares[field(w, Field.ZeroOp)];
    return op ? { cond, kind: "vfcmp", op, zero: true, q, d, n: m, m } : unsupported(cond);
  }
  if (masked(w, Encoding.EstimateMask) === Encoding.Estimate && flag(w, Bit.Float))
    return { cond, kind: "vestimate", sqrt: flag(w, Bit.Sqrt), q, d, m };
  const size = field(w, ArmField.Size);
  if (
    masked(w, Encoding.NarrowMask) === Encoding.Narrow &&
    (size === Size.Half || size === Size.Word)
  )
    return { cond, kind: "vmovn", wide: size === Size.Word, d, m };
  const integerWord = field(w, Field.Size) === IntegerWord;
  if (masked(w, Encoding.AddMask) === Encoding.Add && integerWord)
    return { cond, kind: "viarith", sub: u, q, d, n, m };
  return decodeSimdPermute(w, r, size, integerWord);
}

function decodeSimdPermute(
  w: number,
  { d, n, m, q }: SimdRegisters,
  size: number,
  integerWord: boolean,
): Instruction | undefined {
  if (masked(w, Encoding.ZipMask) === Encoding.Zip) {
    const bytes = ElementBytes[size];
    if (size === Size.Double || (size === Size.Word && !q) || !bytes) return unsupported(cond);
    return { cond, kind: "vzip", unzip: !flag(w, Bit.Unzip), q, d, m, bytes };
  }
  if (masked(w, Encoding.PairAddMask) === Encoding.PairAdd && integerWord && !q)
    return { cond, kind: "vpadd", float: false, d, n, m };
  if (masked(w, Encoding.StepMask) === Encoding.Step)
    return { cond, kind: "vstep", sqrt: flag(w, Bit.Step), q, d, n, m };
  if (masked(w, Encoding.TransposeMask) === Encoding.Transpose) {
    const bytes = ElementBytes[size];
    if (!bytes) return unsupported(cond);
    return { cond, kind: "vtrn", q, d, m, bytes };
  }
  if (masked(w, Encoding.DuplicateMask) === Encoding.Duplicate) {
    const imm4 = field(w, Field.Imm4High);
    if (imm4 & Scalar.Byte)
      return { cond, kind: "vdup", q, d, m, bytes: 1, index: imm4 >> Scalar.ByteShift };
    if (imm4 & Scalar.Half)
      return { cond, kind: "vdup", q, d, m, bytes: 2, index: imm4 >> Scalar.HalfShift };
    if (imm4 & Scalar.Word)
      return { cond, kind: "vdup", q, d, m, bytes: 4, index: imm4 >> Scalar.WordShift };
  }
  return undefined;
}
