import { bit, field, flag } from "./bits";
import { ArmBit, ArmField } from "./decode-fields";
import type { SimdRegisters } from "./decode-neon";
import { decodeSimdImmediate } from "./decode-neon-immediate";
import { decodeSimdExtra } from "./decode-neon-extra";
import { decodeSimdOther } from "./decode-neon-other";
import { Condition, unsupported, type Instruction } from "./instruction";

const cond = Condition.Unconditional;
const Encoding = {
  CompareIntegerMask: 0xfe800f10,
  CompareInteger: 0xf2000810,
  IntegerUnaryMask: 0xffbf0f10,
  IntegerUnary: 0xf3b90300,
  ShiftRegisterMask: 0xfe800f10,
  ShiftRegister: 0xf2000400,
  FloatSignMask: 0xffbf0f90,
  FloatNegate: 0xf3b90780,
  FloatAbsolute: 0xf3b90700,
  ConvertMask: 0xffbf0e10,
  Convert: 0xf3bb0600,
} as const;
const Field = {
  Type: { shift: 8, width: 4 },
  Size: { shift: 20, width: 2 },
  ConvertOp: { shift: 7, width: 2 },
} as const;
const Type = { Logic: 0b0001, Float: 0b1101, FloatMinMax: 0b1111 } as const;
const WordSize = 0b10;
const ConvertToInteger = 2;
const FloatBit = 10;
const ScalarOps: Partial<Record<number, "mla" | "mls" | "mul">> = {
  0b0001: "mla",
  0b0101: "mls",
  0b1001: "mul",
};
const UnsignedLogic = ["eor", "bsl", "bit", "bif"] as const;
const SignedLogic = ["and", "bic", "orr", "orn"] as const;

const masked = (w: number, mask: number): number => (w & mask) >>> 0;

type Matcher = (w: number, r: SimdRegisters, u: boolean) => Instruction | undefined;

/** Advanced SIMD data processing (0b1111001x). Matchers run in encoding-precedence order. */
export function decodeSimdData(w: number, registers: SimdRegisters): Instruction {
  const u = flag(w, ArmBit.Unsigned);
  for (const matcher of Matchers) {
    const instruction = matcher(w, registers, u);
    if (instruction) return instruction;
  }
  return unsupported(cond);
}

const threeSameFloat: Matcher = (w, { d, n, m, q }, u) => {
  const type = field(w, Field.Type),
    up = flag(w, ArmBit.Up),
    op = flag(w, ArmBit.S),
    register = flag(w, ArmBit.Register),
    high = flag(w, ArmBit.Writeback);
  if (!up && type === Type.Float && !op) {
    if (!register && !u) return { cond, kind: "vfloat", op: high ? "sub" : "add", q, d, n, m };
    if (register && u && !high) return { cond, kind: "vfloat", op: "mul", q, d, n, m };
    if (register && !u) return { cond, kind: "vfloat", op: high ? "mls" : "mla", q, d, n, m };
    if (!register && u && !high && !q) return { cond, kind: "vpadd", float: true, d, n, m };
    return unsupported(cond);
  }
  if (!up && type === Type.FloatMinMax && !op && !register && !u)
    return { cond, kind: "vfloat", op: high ? "min" : "max", q, d, n, m };
  if (!up && type === Type.FloatMinMax && !op && !register && u && !q)
    return { cond, kind: "vpminmax", max: !high, d, n, m };
  return undefined;
};

const integerForms: Matcher = (w, { d, n, m, q }, u) => {
  const word = field(w, Field.Size) === WordSize;
  if (masked(w, Encoding.CompareIntegerMask) === Encoding.CompareInteger && word)
    return { cond, kind: "vicompare", test: !u, q, d, n, m };
  if (masked(w, Encoding.IntegerUnaryMask) === Encoding.IntegerUnary && !flag(w, FloatBit))
    return { cond, kind: "viunary", abs: !flag(w, ArmBit.High), q, d, m };
  if (masked(w, Encoding.ShiftRegisterMask) === Encoding.ShiftRegister && word)
    return { cond, kind: "vshlreg", unsigned: u, q, d, n, m };
  if (masked(w, Encoding.FloatSignMask) === Encoding.FloatNegate)
    return { cond, kind: "vfneg", q, d, m };
  if (masked(w, Encoding.FloatSignMask) === Encoding.FloatAbsolute)
    return { cond, kind: "vfneg", q, d, m, abs: true };
  if (flag(w, ArmBit.Up) && word && flag(w, ArmBit.Q) && !flag(w, ArmBit.Register)) {
    const op = ScalarOps[field(w, Field.Type)];
    const index = bit(w, ArmBit.M);
    if (op) return { cond, kind: "vmulscalar", op, q: u, d, n, m: field(w, ArmField.Rm), index };
  }
  if (masked(w, Encoding.ConvertMask) === Encoding.Convert) {
    const op = field(w, Field.ConvertOp);
    const signed = !(op & 1);
    return { cond, kind: "vfcvt", toInt: op >= ConvertToInteger, signed, q, d, m };
  }
  return undefined;
};

const logic: Matcher = (w, { d, n, m, q }, u) => {
  if (flag(w, ArmBit.Up) || field(w, Field.Type) !== Type.Logic || !flag(w, ArmBit.Register))
    return undefined;
  const c = field(w, Field.Size);
  const op = u ? UnsignedLogic[c] : SignedLogic[c];
  if (!op) return unsupported(cond);
  return { cond, kind: "vlogic", op, q, d, n, m };
};

const Matchers: readonly Matcher[] = [
  threeSameFloat,
  integerForms,
  logic,
  decodeSimdExtra,
  decodeSimdImmediate,
  decodeSimdOther,
];
