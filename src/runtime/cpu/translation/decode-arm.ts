import { field, flag, registerList, ror, signBit } from "./bits";
import { decodeMedia } from "./decode-arm-media";
import { ArmBit, ArmField } from "./decode-fields";
import { decodeUnconditional } from "./decode-neon";
import { decodeVfpData, decodeVfpTransfer } from "./decode-vfp";
import {
  Condition,
  AccessBytes,
  Register,
  RegisterCount,
  nop,
  unsupported,
  type Instruction,
  type MemoryOffset,
  type Operand,
} from "./instruction";

const Encoding = {
  MulHalfMask: 0x0ff0f090,
  MulHalf: 0x01600080,
  MulHalfAccumulateMask: 0x0ff00090,
  MulHalfAccumulate: 0x01000080,
  ExchangeMask: 0x0ffffff0,
  Exchange: 0x012fff10,
  ExchangeLink: 0x012fff30,
  ClzMask: 0x0fff0ff0,
  Clz: 0x016f0f10,
  HintMask: 0x0fffff00,
  Hint: 0x0320f000,
  LoadExclusiveMask: 0x0ff00fff,
  LoadExclusive: 0x01900f9f,
  StoreExclusiveMask: 0x0ff00ff0,
  StoreExclusive: 0x01800f90,
} as const;
const Group = {
  Register: 0b000,
  Immediate: 0b001,
  WordImmediate: 0b010,
  WordRegister: 0b011,
  Multiple: 0b100,
  Branch: 0b101,
  Transfer: 0b110,
} as const;
const Misc = {
  OpcodeClassMask: 0b1100,
  CompareClass: 0b1000,
  MoveWide: 0b1000,
  MoveTop: 0b1010,
  MoveHighShift: 12,
  MaxHint: 4,
  RotateScale: 2,
  LongFirst: 0b0100,
  LongLast: 0b0111,
  LongSigned: 0b00100,
  LongAccumulate: 0b00010,
  MultiplyPlain: 0b000,
  MultiplyAccumulate: 0b001,
  MultiplySubtract: 0b011,
  HalfUnsigned: 1,
  HalfSignedByte: 2,
  OffsetHighShift: 4,
  UserMode: 22,
} as const;
const Pipeline = 8;
const Branch = { Left: 8, Right: 6 } as const;
const HalfImmediate = { High: { shift: 8, width: 4 }, Low: { shift: 0, width: 4 } } as const;

export function decode(w: number, pc: number): Instruction {
  const cond = field(w, ArmField.Cond);
  if (cond === Condition.Unconditional) return decodeUnconditional(w, pc);
  const rd = field(w, ArmField.Rn),
    rn = field(w, ArmField.Rm),
    rm = field(w, ArmField.Rs),
    nTop = flag(w, ArmBit.NTop),
    mTop = flag(w, ArmBit.MTop);
  if ((w & Encoding.MulHalfMask) === Encoding.MulHalf)
    return { cond, kind: "mulhalf", rd, rn, rm, nTop, mTop };
  if ((w & Encoding.MulHalfAccumulateMask) === Encoding.MulHalfAccumulate)
    return { cond, kind: "mulhalf", rd, rn, rm, ra: field(w, ArmField.Rd), nTop, mTop };
  switch (field(w, ArmField.Group)) {
    case Group.Register:
      return decodeRegisterGroup(w, cond);
    case Group.Immediate:
      return decodeImmediateGroup(w, cond);
    case Group.WordImmediate:
      return decodeWordMemory(w, cond, false);
    case Group.WordRegister:
      return flag(w, ArmBit.Register) ? decodeMedia(w, cond) : decodeWordMemory(w, cond, true);
    case Group.Multiple:
      return decodeMultiple(w, cond);
    case Group.Branch:
      return {
        cond,
        kind: "branch",
        link: flag(w, ArmBit.Link),
        target: (pc + Pipeline + ((w << Branch.Left) >> Branch.Right)) >>> 0,
      };
    case Group.Transfer:
      return decodeVfpTransfer(w, cond);
    default:
      return flag(w, ArmBit.Link) ? unsupported(cond) : decodeVfpData(w, cond);
  }
}

function shiftedRegister(w: number): Extract<Operand, { kind: "reg" }> {
  return {
    kind: "reg",
    rm: field(w, ArmField.Rm),
    shift: field(w, ArmField.ShiftType),
    amount: field(w, ArmField.ShiftAmount),
  };
}

function decodeRegisterGroup(w: number, cond: number): Instruction {
  if (flag(w, ArmBit.Register) && flag(w, ArmBit.Multiply)) {
    if (field(w, ArmField.ShiftType) === 0) return decodeMultiply(w, cond);
    return decodeHalfMemory(w, cond);
  }
  const op = field(w, ArmField.Opcode),
    s = flag(w, ArmBit.S);
  if ((op & Misc.OpcodeClassMask) === Misc.CompareClass && !s) {
    const rm = field(w, ArmField.Rm);
    if ((w & Encoding.ExchangeMask) === Encoding.Exchange)
      return { cond, kind: "bx", link: false, rm };
    if ((w & Encoding.ExchangeMask) === Encoding.ExchangeLink)
      return { cond, kind: "bx", link: true, rm };
    if ((w & Encoding.ClzMask) === Encoding.Clz)
      return { cond, kind: "clz", rd: field(w, ArmField.Rd), rm };
    return unsupported(cond);
  }
  const rn = field(w, ArmField.Rn),
    rd = field(w, ArmField.Rd);
  if (flag(w, ArmBit.Register)) {
    const rs = field(w, ArmField.Rs),
      rm = field(w, ArmField.Rm);
    if (rs === Register.PC || rm === Register.PC || rd === Register.PC || rn === Register.PC)
      return unsupported(cond);
    const shift = field(w, ArmField.ShiftType);
    return { cond, kind: "data", op, s, rn, rd, operand: { kind: "rshift", rm, shift, rs } };
  }
  return { cond, kind: "data", op, s, rn, rd, operand: shiftedRegister(w) };
}

function decodeImmediateGroup(w: number, cond: number): Instruction {
  if ((w & Encoding.HintMask) === Encoding.Hint && field(w, ArmField.Imm8) <= Misc.MaxHint)
    return { ...nop(), cond };
  const op = field(w, ArmField.Opcode),
    s = flag(w, ArmBit.S);
  if ((op & Misc.OpcodeClassMask) === Misc.CompareClass && !s) {
    const value = (field(w, ArmField.Rn) << Misc.MoveHighShift) | field(w, ArmField.Imm12);
    if (op === Misc.MoveWide) return { cond, kind: "movw", rd: field(w, ArmField.Rd), value };
    if (op === Misc.MoveTop) return { cond, kind: "movt", rd: field(w, ArmField.Rd), value };
    return unsupported(cond);
  }
  const rotate = field(w, ArmField.Rs) * Misc.RotateScale,
    value = ror(field(w, ArmField.Imm8), rotate);
  return {
    cond,
    kind: "data",
    op,
    s,
    rn: field(w, ArmField.Rn),
    rd: field(w, ArmField.Rd),
    operand: { kind: "imm", value, carry: rotate === 0 ? undefined : signBit(value) },
  };
}

function decodeMultiply(w: number, cond: number): Instruction {
  const op = field(w, ArmField.MultiplyOp),
    rd = field(w, ArmField.Rn),
    ra = field(w, ArmField.Rd),
    rm = field(w, ArmField.Rs),
    rn = field(w, ArmField.Rm);
  if ((w & Encoding.LoadExclusiveMask) === Encoding.LoadExclusive)
    return { cond, kind: "exclusive", load: true, rn: rd, rt: ra, rd: 0, offset: 0 };
  if ((w & Encoding.StoreExclusiveMask) === Encoding.StoreExclusive)
    return { cond, kind: "exclusive", load: false, rn: rd, rt: rn, rd: ra, offset: 0 };
  if (field(w, ArmField.Top) !== 0) return unsupported(cond);
  const group = op >> 1,
    s = (op & 1) === 1;
  if (group >= Misc.LongFirst && group <= Misc.LongLast && !s) {
    const signed = !!(op & Misc.LongSigned),
      accumulate = !!(op & Misc.LongAccumulate);
    return { cond, kind: "mull", signed, accumulate, lo: ra, hi: rd, rn, rm };
  }
  switch (group) {
    case Misc.MultiplyPlain:
      return { cond, kind: "mul", accumulate: "none", s, rd, rn, rm, ra };
    case Misc.MultiplyAccumulate:
      return { cond, kind: "mul", accumulate: "add", s, rd, rn, rm, ra };
    case Misc.MultiplySubtract:
      return s ? unsupported(cond) : { cond, kind: "mul", accumulate: "sub", s, rd, rn, rm, ra };
    default:
      return unsupported(cond);
  }
}

function halfOffset(w: number): MemoryOffset {
  return flag(w, ArmBit.Immediate)
    ? {
        kind: "imm",
        value: (field(w, HalfImmediate.High) << Misc.OffsetHighShift) | field(w, HalfImmediate.Low),
      }
    : { kind: "reg", rm: field(w, ArmField.Rm), shift: 0, amount: 0 };
}

function decodeHalfMemory(w: number, cond: number): Instruction {
  const load = flag(w, ArmBit.Load),
    sh = field(w, ArmField.ShiftType);
  const pre = flag(w, ArmBit.Pre),
    add = flag(w, ArmBit.Up),
    wbit = flag(w, ArmBit.Writeback);
  const rn = field(w, ArmField.Rn),
    rd = field(w, ArmField.Rd);
  if (!load && sh !== Misc.HalfUnsigned) {
    if (rd & 1 || rd === Register.LR || (!pre && wbit)) return unsupported(cond);
    const offset = halfOffset(w);
    const pairLoad = sh === Misc.HalfSignedByte;
    return {
      cond,
      kind: "pair",
      load: pairLoad,
      rn,
      rt: rd,
      rt2: rd + 1,
      offset,
      add,
      pre,
      writeback: !pre || wbit,
    };
  }
  const byte = load && sh === Misc.HalfSignedByte;
  const size = byte ? AccessBytes.Byte : AccessBytes.Half,
    signed = load && sh !== Misc.HalfUnsigned;
  if (!pre && wbit) return unsupported(cond);
  const offset = halfOffset(w);
  return {
    cond,
    kind: "mem",
    load,
    size,
    signed,
    rn,
    rd,
    offset,
    add,
    pre,
    writeback: !pre || wbit,
  };
}

function decodeWordMemory(w: number, cond: number, register: boolean): Instruction {
  const pre = flag(w, ArmBit.Pre),
    wbit = flag(w, ArmBit.Writeback);
  if (!pre && wbit) return unsupported(cond);
  const offset: MemoryOffset = register
    ? shiftedRegister(w)
    : { kind: "imm", value: field(w, ArmField.Imm12) };
  return {
    cond,
    kind: "mem",
    load: flag(w, ArmBit.Load),
    size: flag(w, ArmBit.Byte) ? AccessBytes.Byte : AccessBytes.Word,
    signed: false,
    rn: field(w, ArmField.Rn),
    rd: field(w, ArmField.Rd),
    offset,
    add: flag(w, ArmBit.Up),
    pre,
    writeback: !pre || wbit,
  };
}
function decodeMultiple(w: number, cond: number): Instruction {
  if (flag(w, Misc.UserMode)) return unsupported(cond);
  const registers = registerList(w, RegisterCount);
  if (!registers.length) return unsupported(cond);
  return {
    cond,
    kind: "multiple",
    load: flag(w, ArmBit.Load),
    rn: field(w, ArmField.Rn),
    registers,
    increment: flag(w, ArmBit.Up),
    before: flag(w, ArmBit.Pre),
    writeback: flag(w, ArmBit.Writeback),
  };
}
