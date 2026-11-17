import { WordBytes, align4, bit, field, flag, registerList, signExtend } from "./bits";
import { DataOp, Register, unsupported, type Instruction, type TransferSize } from "./instruction";
import { decodeThumbMisc } from "./thumb-misc";
import {
  ThumbPipeline,
  data,
  immediate,
  register,
  transfer,
  type NarrowDecoder,
} from "./thumb-shared";

const Field = {
  Opcode: { shift: 11, width: 5 },
  Low: { shift: 0, width: 3 },
  Middle: { shift: 3, width: 3 },
  Third: { shift: 6, width: 3 },
  High: { shift: 8, width: 3 },
  ShiftType: { shift: 11, width: 2 },
  ShiftAmount: { shift: 6, width: 5 },
  AddSubtract: { shift: 9, width: 2 },
  Imm8: { shift: 0, width: 8 },
  Imm5: { shift: 6, width: 5 },
  Imm11: { shift: 0, width: 11 },
  AluOp: { shift: 6, width: 4 },
  SpecialOp: { shift: 8, width: 2 },
  Rm4: { shift: 3, width: 4 },
  LoadForm: { shift: 9, width: 3 },
  Condition: { shift: 8, width: 4 },
  List: { shift: 0, width: 8 },
} as const;
const Bit = { Load: 11, Special: 10, HighRegister: 7, Link: 7 } as const;
const Subtract = 1;
const ImmediateForm = 2;
const HighRegisterShift = 3;
const LowRegisters = 8;
const ConditionalBranch = { Reserved: 14, Bits: 9 } as const;
const UnconditionalBranch = 12;
const Scale = { Half: 2, Word: 4 } as const;
const Special = { Add: 0, Compare: 1, Move: 2 } as const;
const AluShift: Partial<Record<number, number>> = { 2: 0, 3: 1, 4: 2, 7: 3 };
const Alu = { Negate: 0b1001, Multiply: 0b1101 } as const;
const AluMap: Partial<Record<number, number>> = {
  0: DataOp.AND,
  1: DataOp.EOR,
  5: DataOp.ADC,
  6: DataOp.SBC,
  8: DataOp.TST,
  10: DataOp.CMP,
  11: DataOp.CMN,
  12: DataOp.ORR,
  14: DataOp.BIC,
  15: DataOp.MVN,
};
const LoadForms: Partial<Record<number, { load: boolean; size: TransferSize; signed: boolean }>> = {
  0: { load: false, size: 4, signed: false },
  1: { load: false, size: 2, signed: false },
  2: { load: false, size: 1, signed: false },
  3: { load: true, size: 1, signed: true },
  4: { load: true, size: 4, signed: false },
  5: { load: true, size: 2, signed: false },
  6: { load: true, size: 1, signed: false },
  7: { load: true, size: 2, signed: true },
};

const low = (h: number) => field(h, Field.Low);
const middle = (h: number) => field(h, Field.Middle);
const high = (h: number) => field(h, Field.High);
const imm8 = (h: number) => field(h, Field.Imm8);

const shiftImmediate: NarrowDecoder = (h, _pc, cond, s) => {
  const type = field(h, Field.ShiftType),
    amount = field(h, Field.ShiftAmount);
  return data(cond, DataOp.MOV, s, 0, low(h), register(middle(h), type, amount));
};

const addSubtract: NarrowDecoder = (h, _pc, cond, s) => {
  const opc = field(h, Field.AddSubtract),
    third = field(h, Field.Third);
  const op = opc & Subtract ? DataOp.SUB : DataOp.ADD;
  return data(
    cond,
    op,
    s,
    middle(h),
    low(h),
    opc & ImmediateForm ? immediate(third) : register(third),
  );
};

function aluRegister(h: number, cond: number, s: boolean): Instruction {
  const rd = low(h),
    rm3 = middle(h),
    op = field(h, Field.AluOp);
  const shift = AluShift[op];
  if (shift !== undefined)
    return data(cond, DataOp.MOV, s, 0, rd, { kind: "rshift", rm: rd, rs: rm3, shift });
  if (op === Alu.Negate) return data(cond, DataOp.RSB, s, rm3, rd, immediate(0));
  if (op === Alu.Multiply)
    return { cond, kind: "mul", accumulate: "none", s, rd, rn: rm3, rm: rd, ra: 0 };
  const mapped = AluMap[op] ?? -1;
  const compare = mapped >= DataOp.TST && mapped <= DataOp.CMN;
  return data(cond, mapped, compare || s, rd, rd, register(rm3));
}

const dataProcessing: NarrowDecoder = (h, _pc, cond, s) => {
  if (!flag(h, Bit.Special)) return aluRegister(h, cond, s);
  const op = field(h, Field.SpecialOp),
    rdn = (bit(h, Bit.HighRegister) << HighRegisterShift) | low(h),
    rm = field(h, Field.Rm4);
  if (op === Special.Add) return data(cond, DataOp.ADD, false, rdn, rdn, register(rm));
  if (op === Special.Compare) return data(cond, DataOp.CMP, true, rdn, 0, register(rm));
  if (op === Special.Move) return data(cond, DataOp.MOV, false, 0, rdn, register(rm));
  return { cond, kind: "bx", link: flag(h, Bit.Link), rm };
};

const literal: NarrowDecoder = (h, _pc, cond) =>
  transfer(cond, true, WordBytes, false, Register.PC, high(h), imm8(h) * Scale.Word);

const registerOffset: NarrowDecoder = (h, _pc, cond) => {
  const form = LoadForms[field(h, Field.LoadForm)] ?? { load: false, size: 4, signed: false };
  const offset = { kind: "reg", rm: field(h, Field.Third), shift: 0, amount: 0 } as const;
  return transfer(cond, form.load, form.size, form.signed, middle(h), low(h), offset);
};

const scaled =
  (size: TransferSize, scale: number): NarrowDecoder =>
  (h, _pc, cond) =>
    transfer(cond, flag(h, Bit.Load), size, false, middle(h), low(h), field(h, Field.Imm5) * scale);

const stackRelative: NarrowDecoder = (h, _pc, cond) =>
  transfer(cond, flag(h, Bit.Load), WordBytes, false, Register.SP, high(h), imm8(h) * Scale.Word);

const address: NarrowDecoder = (h, pc, cond) =>
  data(
    cond,
    DataOp.MOV,
    false,
    0,
    high(h),
    immediate(align4(pc + ThumbPipeline) + imm8(h) * Scale.Word),
  );

const stackAddress: NarrowDecoder = (h, _pc, cond) =>
  data(cond, DataOp.ADD, false, Register.SP, high(h), immediate(imm8(h) * Scale.Word));

const multiple: NarrowDecoder = (h, _pc, cond) => {
  const rn = high(h),
    registers = registerList(field(h, Field.List), LowRegisters);
  if (!registers.length) return unsupported(cond);
  const load = flag(h, Bit.Load);
  const writeback = !(load && registers.includes(rn));
  return { cond, kind: "multiple", load, rn, registers, increment: true, before: false, writeback };
};

const conditionalBranch: NarrowDecoder = (h, pc, cond) => {
  const c = field(h, Field.Condition);
  if (c >= ConditionalBranch.Reserved) return unsupported(cond);
  const offset = signExtend(imm8(h) << 1, ConditionalBranch.Bits);
  return { cond: c, kind: "branch", link: false, target: (pc + ThumbPipeline + offset) | 1 };
};

const branch: NarrowDecoder = (h, pc, cond) => {
  const offset = signExtend(field(h, Field.Imm11) << 1, UnconditionalBranch);
  return { cond, kind: "branch", link: false, target: (pc + ThumbPipeline + offset) | 1 };
};

const Decoders: Partial<Record<number, NarrowDecoder>> = {
  0b00000: shiftImmediate,
  0b00001: shiftImmediate,
  0b00010: shiftImmediate,
  0b00011: addSubtract,
  0b00100: (h, _pc, cond, s) => data(cond, DataOp.MOV, s, 0, high(h), immediate(imm8(h))),
  0b00101: (h, _pc, cond) => data(cond, DataOp.CMP, true, high(h), 0, immediate(imm8(h))),
  0b00110: (h, _pc, cond, s) => data(cond, DataOp.ADD, s, high(h), high(h), immediate(imm8(h))),
  0b00111: (h, _pc, cond, s) => data(cond, DataOp.SUB, s, high(h), high(h), immediate(imm8(h))),
  0b01000: dataProcessing,
  0b01001: literal,
  0b01010: registerOffset,
  0b01011: registerOffset,
  0b01100: scaled(WordBytes, Scale.Word),
  0b01101: scaled(WordBytes, Scale.Word),
  0b01110: scaled(1, 1),
  0b01111: scaled(1, 1),
  0b10000: scaled(Scale.Half, Scale.Half),
  0b10001: scaled(Scale.Half, Scale.Half),
  0b10010: stackRelative,
  0b10011: stackRelative,
  0b10100: address,
  0b10101: stackAddress,
  0b10110: decodeThumbMisc,
  0b10111: decodeThumbMisc,
  0b11000: multiple,
  0b11001: multiple,
  0b11010: conditionalBranch,
  0b11011: conditionalBranch,
  0b11100: branch,
};

/** 16-bit Thumb instruction; inside an IT block the flag-setting forms do not set flags. */
export function decodeThumb16(h: number, pc: number, cond: number, inIt: boolean): Instruction {
  const decoder = Decoders[field(h, Field.Opcode)];
  return decoder ? decoder(h, pc, cond, !inIt) : unsupported(cond);
}
