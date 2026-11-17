import { bit, field, flag } from "./bits";
import { ArmBit, ArmField, vfpRegister } from "./decode-fields";
import { Register, unsupported, type Instruction } from "./instruction";

const Encoding = {
  ThreadPointerMask: 0x0fff0fff,
  ThreadPointer: 0x0e1d0f70,
  CoreMask: 0x0fe00f7f,
  Core: 0x0e000a10,
  StatusMask: 0x0fff0fff,
  Status: 0x0ef10a10,
  DuplicateMask: 0x0fd00f7f,
  Duplicate: 0x0e800b10,
  ToScalarMask: 0x0f900f1f,
  ToScalar: 0x0e000b10,
  FromScalarMask: 0x0f100f1f,
  FromScalar: 0x0e100b10,
} as const;
const Scalar = { ByteForm: 2, HalfForm: 1, ByteIndexShift: 2, HalfIndexShift: 1 } as const;
const DuplicateQ = 21;
const ScalarUnsigned = 23;
const CoreRegisterShift = 1;

/** Core register, status and scalar transfers in the VFP/Advanced SIMD space (bit 4 set). */
export function decodeVfpMove(w: number, cond: number): Instruction {
  const rt = field(w, ArmField.Rd);
  if ((w & Encoding.ThreadPointerMask) === Encoding.ThreadPointer && rt !== Register.PC)
    return { cond, kind: "tls", rd: rt };
  if ((w & Encoding.CoreMask) === Encoding.Core) {
    const s = (field(w, ArmField.Rn) << CoreRegisterShift) | bit(w, ArmBit.N);
    return { cond, kind: "vmovcore", toCore: flag(w, ArmBit.Load), rt, s };
  }
  if ((w & Encoding.StatusMask) === Encoding.Status) return { cond, kind: "vmrs", rt };
  const d = vfpRegister(field(w, ArmField.Rn), bit(w, ArmBit.N), true);
  if ((w & Encoding.DuplicateMask) === Encoding.Duplicate && rt !== Register.PC)
    return { cond, kind: "vdupcore", q: flag(w, DuplicateQ), d, rt };
  const opc1 = field(w, ArmField.Opc1),
    opc2 = field(w, ArmField.Opc2);
  const byteIndex = ((opc1 & 1) << Scalar.ByteIndexShift) | opc2,
    halfIndex = ((opc1 & 1) << Scalar.HalfIndexShift) | (opc2 >> 1),
    wordIndex = opc1 & 1;
  if ((w & Encoding.ToScalarMask) === Encoding.ToScalar) {
    if (opc1 & Scalar.ByteForm)
      return { cond, kind: "vmovscalar", bytes: 1, index: byteIndex, d, rt };
    if (opc2 & Scalar.HalfForm)
      return { cond, kind: "vmovscalar", bytes: 2, index: halfIndex, d, rt };
    if (opc2 === 0) return { cond, kind: "vmovscalar", bytes: 4, index: wordIndex, d, rt };
  }
  if ((w & Encoding.FromScalarMask) === Encoding.FromScalar) {
    const signed = !flag(w, ScalarUnsigned);
    if (rt === Register.PC) return unsupported(cond);
    if (opc1 & Scalar.ByteForm)
      return { cond, kind: "vmovscalar", bytes: 1, index: byteIndex, d, rt, toCore: true, signed };
    if (opc2 & Scalar.HalfForm)
      return { cond, kind: "vmovscalar", bytes: 2, index: halfIndex, d, rt, toCore: true, signed };
    if (opc2 === 0 && signed)
      return { cond, kind: "vmovscalar", bytes: 4, index: wordIndex, d, rt, toCore: true };
  }
  return unsupported(cond);
}
