import { ByteBits, bit, field } from "./bits";
import { ArmBit, ArmField } from "./decode-fields";
import type { SimdRegisters } from "./decode-neon";
import { vfpExpand } from "./decode-vfp";
import { Condition, unsupported, type Instruction } from "./instruction";
import type { LaneBytes } from "./vector-instruction";

const cond = Condition.Unconditional;
const Encoding = {
  ImmediateMask: 0xfeb80090,
  Immediate: 0xf2800010,
  LengthenMask: 0xfe870fd0,
  Lengthen: 0xf2800a10,
} as const;
const Mode = {
  Field: { shift: 8, width: 4 },
  Op: 5,
  ShiftedLimit: 12,
  Bytes: 14,
  Float: 15,
  WordGroups: 4,
  HalfGroups: 6,
  OnesGroup: 6,
} as const;
const Immediate = { Top: 7, Middle: { shift: 16, width: 3 }, MiddleShift: 4 } as const;
const LengthenSize: Partial<Record<number, LaneBytes>> = { 1: 1, 2: 2, 4: 4 };
const Wide = {
  Word: 32n,
  Half: 16n,
  Byte: 8n,
  Zero: 0n,
  ByteOnes: 0xffn,
  HalfOnes: 0xffffn,
  Mask: 0xffffffffffffffffn,
  Bytes: 8,
} as const;

/** AdvSIMDExpandImm for the VMOV/VMVN immediate forms; undefined where the encoding is reserved. */
export function simdExpand(op: number, cmode: number, imm8: number): bigint | undefined {
  const byte = BigInt(imm8);
  const replicate32 = (value: bigint) => (value << Wide.Word) | value;
  const replicate16 = (value: bigint) => replicate32((value << Wide.Half) | value);
  const group = cmode >> 1;
  if (group < Mode.WordGroups) return replicate32(byte << BigInt(group * ByteBits));
  if (group < Mode.HalfGroups)
    return replicate16(byte << BigInt((group - Mode.WordGroups) * ByteBits));
  if (group === Mode.OnesGroup)
    return replicate32(
      cmode & 1 ? (byte << Wide.Half) | Wide.HalfOnes : (byte << Wide.Byte) | Wide.ByteOnes,
    );
  if (cmode & 1) return undefined;
  let value = Wide.Zero;
  for (let index = 0; index < Wide.Bytes; index++) {
    const position = BigInt(ByteBits * index);
    if (!op) value |= byte << position;
    else if ((imm8 >> index) & 1) value |= Wide.ByteOnes << position;
  }
  return value;
}

/** VMOV/VMVN (immediate) and VMOVL. */
export function decodeSimdImmediate(
  w: number,
  { d, m, q }: SimdRegisters,
  u: boolean,
): Instruction | undefined {
  if ((w & Encoding.ImmediateMask) >>> 0 === Encoding.Immediate) {
    const cmode = field(w, Mode.Field),
      op = bit(w, Mode.Op);
    if ((cmode < Mode.ShiftedLimit && cmode & 1) || (op && cmode === Mode.Float))
      return unsupported(cond);
    const imm8 =
      (bit(w, ArmBit.Unsigned) << Immediate.Top) |
      (field(w, Immediate.Middle) << Immediate.MiddleShift) |
      field(w, ArmField.Rm);
    if (op && cmode !== Mode.Bytes) {
      const value = simdExpand(0, cmode, imm8);
      return value === undefined
        ? unsupported(cond)
        : { cond, kind: "vmovi", q, d, value: ~value & Wide.Mask };
    }
    if (cmode === Mode.Float) {
      const single = vfpExpand(imm8, false);
      return { cond, kind: "vmovi", q, d, value: (single << Wide.Word) | single };
    }
    const value = simdExpand(op, cmode, imm8);
    if (value === undefined) return unsupported(cond);
    return { cond, kind: "vmovi", q, d, value };
  }
  if ((w & Encoding.LengthenMask) >>> 0 === Encoding.Lengthen) {
    const bytes = LengthenSize[field(w, ArmField.NeonImm3)];
    if (!bytes) return unsupported(cond);
    return { cond, kind: "vmovl", signed: !u, bytes, d, m };
  }
  return undefined;
}
