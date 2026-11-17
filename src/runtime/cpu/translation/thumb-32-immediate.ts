import { WordBits, align4, bit, field, flag, ror, signBit, signExtend } from "./bits";
import { DataOp, Register, nop, unsupported, type Instruction, type Operand } from "./instruction";
import { ThumbPipeline, data, immediate, wideData } from "./thumb-shared";

const Field = {
  Op: { shift: 4, width: 5 },
  WideOp: { shift: 5, width: 4 },
  Rn: { shift: 0, width: 4 },
  Rd: { shift: 8, width: 4 },
  Imm3: { shift: 12, width: 3 },
  Imm8: { shift: 0, width: 8 },
  Imm2: { shift: 6, width: 2 },
  Msb: { shift: 0, width: 5 },
  Condition: { shift: 6, width: 4 },
  Imm6: { shift: 0, width: 6 },
  Imm10: { shift: 0, width: 10 },
  Imm11: { shift: 0, width: 11 },
} as const;
const Bit = { I: 10, Plain: 9, S: 4, J1: 13, J2: 11, Branch: 12, Link: 14 } as const;
const Shift = { I: 11, Imm3: 8, Imm3Lsb: 2, MoveHigh: 12 } as const;
const Op = {
  Add: 0b00000,
  Subtract: 0b01010,
  MoveWide: 0b00100,
  MoveTop: 0b01100,
  BitfieldInsert: 0b10110,
  SignedExtract: 0b10100,
  UnsignedExtract: 0b11100,
} as const;
const Expand = {
  Byte: 0xff,
  Rotated: 10,
  Pattern: { shift: 8, width: 2 },
  HalfShift: 16,
  TopShift: 24,
  ByteShift: 8,
  Top: 0x80,
  Mantissa: 0x7f,
  RotationShift: 7,
} as const;
const Pattern = { Plain: 0, Halves: 1, Odd: 2 } as const;
const Branch = {
  Reserved: 14,
  HintMask: 0xfff0,
  Hint: 0xf3b0,
  Nop: 0xf3af,
  ConditionalS: 20,
  ConditionalJ2: 19,
  ConditionalJ1: 18,
  ConditionalBits: 21,
  S: 24,
  I1: 23,
  I2: 22,
  Bits: 25,
  High: 12,
} as const;

/** ThumbExpandImm_C: the modified immediate, with the shifter carry for rotated forms. */
export function thumbExpand(imm12: number): Operand {
  const imm8 = imm12 & Expand.Byte;
  if (!(imm12 >>> Expand.Rotated)) {
    switch (field(imm12, Expand.Pattern)) {
      case Pattern.Plain:
        return immediate(imm8);
      case Pattern.Halves:
        return immediate((imm8 << Expand.HalfShift) | imm8);
      case Pattern.Odd:
        return immediate((imm8 << Expand.TopShift) | (imm8 << Expand.ByteShift));
      default:
        return immediate(
          (imm8 << Expand.TopShift) |
            (imm8 << Expand.HalfShift) |
            (imm8 << Expand.ByteShift) |
            imm8,
        );
    }
  }
  const value = ror(Expand.Top | (imm12 & Expand.Mantissa), imm12 >>> Expand.RotationShift);
  return immediate(value, signBit(value));
}

/** Data processing with a modified or plain binary immediate (op1 = 0b10, h2 bit 15 clear). */
export function decodeThumbImmediate(
  h1: number,
  h2: number,
  pc: number,
  cond: number,
): Instruction {
  const imm12 =
    (bit(h1, Bit.I) << Shift.I) | (field(h2, Field.Imm3) << Shift.Imm3) | field(h2, Field.Imm8);
  const rn = field(h1, Field.Rn),
    rd = field(h2, Field.Rd);
  if (!flag(h1, Bit.Plain))
    return wideData(field(h1, Field.WideOp), flag(h1, Bit.S), rn, rd, thumbExpand(imm12), cond);
  const op = field(h1, Field.Op);
  const lsb = (field(h2, Field.Imm3) << Shift.Imm3Lsb) | field(h2, Field.Imm2);
  const base = align4(pc + ThumbPipeline);
  switch (op) {
    case Op.Add:
      return rn === Register.PC
        ? data(cond, DataOp.MOV, false, 0, rd, immediate(base + imm12))
        : data(cond, DataOp.ADD, false, rn, rd, immediate(imm12));
    case Op.Subtract:
      return rn === Register.PC
        ? data(cond, DataOp.MOV, false, 0, rd, immediate(base - imm12))
        : data(cond, DataOp.SUB, false, rn, rd, immediate(imm12));
    case Op.MoveWide:
      return { cond, kind: "movw", rd, value: (rn << Shift.MoveHigh) | imm12 };
    case Op.MoveTop:
      return { cond, kind: "movt", rd, value: (rn << Shift.MoveHigh) | imm12 };
    case Op.BitfieldInsert: {
      const msb = field(h2, Field.Msb);
      if (msb < lsb) return unsupported(cond);
      const source = rn === Register.PC ? undefined : rn;
      return { cond, kind: "bitfield", rd, rn: source, lsb, width: msb - lsb + 1 };
    }
    case Op.SignedExtract:
    case Op.UnsignedExtract: {
      const width = field(h2, Field.Msb) + 1;
      if (lsb + width > WordBits) return unsupported(cond);
      return { cond, kind: "extract", signed: op === Op.SignedExtract, rd, rn, lsb, width };
    }
    default:
      return unsupported(cond);
  }
}

/** Branches and hints (op1 = 0b10, h2 bit 15 set). */
export function decodeThumbBranch(h1: number, h2: number, pc: number, cond: number): Instruction {
  const s = bit(h1, Bit.I),
    j1 = bit(h2, Bit.J1),
    j2 = bit(h2, Bit.J2);
  const low = field(h2, Field.Imm11) << 1;
  if (!flag(h2, Bit.Branch) && !flag(h2, Bit.Link)) {
    const c = field(h1, Field.Condition);
    if (c >= Branch.Reserved)
      return (h1 & Branch.HintMask) === Branch.Hint || h1 === Branch.Nop
        ? nop()
        : unsupported(cond);
    const offset = signExtend(
      (s << Branch.ConditionalS) |
        (j2 << Branch.ConditionalJ2) |
        (j1 << Branch.ConditionalJ1) |
        (field(h1, Field.Imm6) << Branch.High) |
        low,
      Branch.ConditionalBits,
    );
    return { cond: c, kind: "branch", link: false, target: (pc + ThumbPipeline + offset) | 1 };
  }
  const i1 = j1 ^ s ^ 1,
    i2 = j2 ^ s ^ 1;
  const offset = signExtend(
    (s << Branch.S) |
      (i1 << Branch.I1) |
      (i2 << Branch.I2) |
      (field(h1, Field.Imm10) << Branch.High) |
      low,
    Branch.Bits,
  );
  if (flag(h2, Bit.Link) && !flag(h2, Bit.Branch))
    return {
      cond,
      kind: "branch",
      link: true,
      target: (align4(pc + ThumbPipeline) + offset) >>> 0,
    };
  const target = ((pc + ThumbPipeline + offset) | 1) >>> 0;
  return { cond, kind: "branch", link: flag(h2, Bit.Link), target };
}
