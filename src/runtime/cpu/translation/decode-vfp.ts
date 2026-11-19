import { WordBytes, bit, field, flag } from "./bits";
import { ArmBit, ArmField, vfpRegister } from "./decode-fields";
import { unsupported, type Instruction } from "./instruction";
import { decodeVfpMove } from "./decode-vfp-move";

const Encoding = {
  MemoryMask: 0x0f200000,
  Memory: 0x0d000000,
  PairMask: 0x0fe000d0,
  Pair: 0x0c400010,
} as const;
const Coprocessor = { Single: 10, Double: 11 } as const;
const VfpRegisters = 32;
const MultipleGroup = 0b110;
const DataSignature = { Field: { shift: 9, width: 3 }, Value: 0b101 } as const;
const DataOpcode = {
  MultiplyAccumulate: 0b000,
  NegatedMultiplyAccumulate: 0b001,
  Multiply: 0b010,
  Add: 0b011,
  Divide: 0b100,
  Other: 0b111,
  HighShift: 2,
  Low: { shift: 20, width: 2 },
} as const;
const Other = {
  Copy: 0,
  Negate: 1,
  Compare: 4,
  CompareZero: 5,
  ConvertPrecision: 7,
  FromInteger: 8,
  ToUnsigned: 12,
  ToSigned: 13,
} as const;
const Immediate = {
  Sign: 7,
  Replicate: 6,
  Fraction: { shift: 4, width: 2 },
  Mantissa: { shift: 0, width: 4 },
  HighShift: 4,
} as const;
const SingleImmediate = {
  ExponentTop: 7,
  Replicated: 0b1111100,
  SignShift: 31n,
  ExponentShift: 23n,
  MantissaShift: 19n,
} as const;
const DoubleImmediate = {
  ExponentTop: 10,
  Replicated: 0b1111111100,
  SignShift: 63n,
  ExponentShift: 52n,
  MantissaShift: 48n,
} as const;

/** VFP loads, stores and two-register transfers (coprocessor group 0b110). */
export function decodeVfpTransfer(w: number, cond: number): Instruction {
  const coprocessor = field(w, ArmField.Rs);
  if (coprocessor !== Coprocessor.Single && coprocessor !== Coprocessor.Double)
    return unsupported(cond);
  const double = coprocessor === Coprocessor.Double;
  const load = flag(w, ArmBit.Load),
    rn = field(w, ArmField.Rn);
  const first = vfpRegister(field(w, ArmField.Rd), bit(w, ArmBit.Double), double);
  if ((w & Encoding.MemoryMask) === Encoding.Memory) {
    const offset = field(w, ArmField.Imm8) * WordBytes;
    const signed = flag(w, ArmBit.Up) ? offset : -offset;
    return { cond, kind: "vmem", load, double, vd: first, rn, offset: signed };
  }
  const before = flag(w, ArmBit.Pre),
    increment = flag(w, ArmBit.Up),
    writeback = flag(w, ArmBit.Writeback);
  if (
    field(w, ArmField.Group) === MultipleGroup &&
    before !== increment &&
    !(before && !writeback)
  ) {
    const imm8 = field(w, ArmField.Imm8),
      count = double ? imm8 >> 1 : imm8;
    if (!count || (double && imm8 & 1) || first + count > VfpRegisters) return unsupported(cond);
    return { cond, kind: "vmulti", load, double, first, count, rn, increment, writeback };
  }
  if ((w & Encoding.PairMask) === Encoding.Pair && double) {
    const dm = vfpRegister(field(w, ArmField.Rm), bit(w, ArmBit.M), true);
    return { cond, kind: "vmovpair", toCore: load, rt: field(w, ArmField.Rd), rt2: rn, dm };
  }
  return unsupported(cond);
}

/** VFPExpandImm: the 8-bit VMOV immediate as single or double bits. */
export function vfpExpand(imm8: number, double: boolean): bigint {
  const sign = BigInt(imm8 >> Immediate.Sign),
    b = bit(imm8, Immediate.Replicate),
    cd = field(imm8, Immediate.Fraction),
    mantissa = BigInt(field(imm8, Immediate.Mantissa));
  const format = double ? DoubleImmediate : SingleImmediate;
  const exponent = BigInt(((b ^ 1) << format.ExponentTop) | (b ? format.Replicated : 0) | cd);
  return (
    (sign << format.SignShift) |
    (exponent << format.ExponentShift) |
    (mantissa << format.MantissaShift)
  );
}

/** VFP data processing (coprocessor group 0b111 with bit 24 clear). */
export function decodeVfpData(w: number, cond: number): Instruction {
  if (flag(w, ArmBit.Register)) return decodeVfpMove(w, cond);
  if (field(w, DataSignature.Field) !== DataSignature.Value) return unsupported(cond);
  const double = flag(w, ArmBit.Sz);
  const d = vfpRegister(field(w, ArmField.Rd), bit(w, ArmBit.Double), double),
    n = vfpRegister(field(w, ArmField.Rn), bit(w, ArmBit.N), double),
    m = vfpRegister(field(w, ArmField.Rm), bit(w, ArmBit.M), double);
  const opc1 = (bit(w, ArmBit.Up) << DataOpcode.HighShift) | field(w, DataOpcode.Low),
    op6 = flag(w, ArmBit.Op6);
  if (opc1 === DataOpcode.MultiplyAccumulate)
    return { cond, kind: "varith", op: op6 ? "mls" : "mla", double, d, n, m };
  if (opc1 === DataOpcode.NegatedMultiplyAccumulate)
    return { cond, kind: "varith", op: op6 ? "nmla" : "nmls", double, d, n, m };
  if (opc1 === DataOpcode.Multiply)
    return { cond, kind: "varith", op: op6 ? "nmul" : "mul", double, d, n, m };
  if (opc1 === DataOpcode.Add)
    return { cond, kind: "varith", op: op6 ? "sub" : "add", double, d, n, m };
  if (opc1 === DataOpcode.Divide && !op6)
    return { cond, kind: "varith", op: "div", double, d, n, m };
  if (opc1 !== DataOpcode.Other) return unsupported(cond);
  const imm = (field(w, ArmField.Rn) << Immediate.HighShift) | field(w, ArmField.Rm);
  if (!op6) return { cond, kind: "vmovimm", double, d, bits: vfpExpand(imm, double) };
  return decodeVfpOther(w, cond, double, d, m);
}

function decodeVfpOther(
  w: number,
  cond: number,
  double: boolean,
  d: number,
  m: number,
): Instruction {
  const opc2 = field(w, ArmField.Rn),
    high = flag(w, ArmBit.High);
  const singleD = vfpRegister(field(w, ArmField.Rd), bit(w, ArmBit.Double), false),
    singleM = vfpRegister(field(w, ArmField.Rm), bit(w, ArmBit.M), false);
  if (opc2 === Other.Copy) return { cond, kind: "vunary", op: high ? "abs" : "mov", double, d, m };
  if (opc2 === Other.Negate)
    return { cond, kind: "vunary", op: high ? "sqrt" : "neg", double, d, m };
  if (opc2 === Other.Compare) return { cond, kind: "vcmp", double, d, m };
  if (opc2 === Other.CompareZero && field(w, ArmField.Rm) === 0 && !flag(w, ArmBit.M))
    return { cond, kind: "vcmp", double, d, m: undefined };
  if (opc2 === Other.ConvertPrecision && high) {
    // sz selects the source width: single -> double writes Dd from Sm, double -> single writes Sd from Dm.
    if (!double) {
      const wide = vfpRegister(field(w, ArmField.Rd), bit(w, ArmBit.Double), true);
      return { cond, kind: "vcvtfd", toDouble: true, d: wide, m: singleM };
    }
    const wide = vfpRegister(field(w, ArmField.Rm), bit(w, ArmBit.M), true);
    return { cond, kind: "vcvtfd", toDouble: false, d: singleD, m: wide };
  }
  if (opc2 === Other.FromInteger)
    return {
      cond,
      kind: "vcvt",
      toInt: false,
      signed: high,
      truncate: false,
      double,
      d,
      m: singleM,
    };
  if (opc2 === Other.ToUnsigned || opc2 === Other.ToSigned) {
    const signed = opc2 === Other.ToSigned;
    return { cond, kind: "vcvt", toInt: true, signed, truncate: high, double, d: singleD, m };
  }
  return unsupported(cond);
}
