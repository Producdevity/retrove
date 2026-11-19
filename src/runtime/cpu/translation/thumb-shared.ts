import {
  DataOp,
  Register,
  ThumbDataOp,
  unsupported,
  type Instruction,
  type MemoryOffset,
  type Operand,
  type TransferSize,
  ShiftType,
} from "./instruction";

/** PC as read by a Thumb instruction: its address plus 4. */
export const ThumbPipeline = 4;

export type NarrowDecoder = (h: number, pc: number, cond: number, setFlags: boolean) => Instruction;

export const immediate = (value: number, carry?: 0 | 1): Operand => ({
  kind: "imm",
  value: value >>> 0,
  carry,
});

export const register = (rm: number, shift = 0, amount = 0): Operand => ({
  kind: "reg",
  rm,
  shift,
  amount,
});

export function data(
  cond: number,
  op: number,
  s: boolean,
  rn: number,
  rd: number,
  operand: Operand,
): Instruction {
  return { cond, kind: "data", op, s, rn, rd, operand };
}

/** Single load or store; a numeric offset is an immediate. */
export function transfer(
  cond: number,
  load: boolean,
  size: TransferSize,
  signed: boolean,
  rn: number,
  rd: number,
  offset: MemoryOffset | number,
  add = true,
  pre = true,
  writeback = false,
): Instruction {
  const resolved: MemoryOffset =
    typeof offset === "number" ? { kind: "imm", value: offset } : offset;
  return {
    cond,
    kind: "mem",
    load,
    size,
    signed,
    rn,
    rd,
    offset: resolved,
    add,
    pre,
    writeback,
  };
}

const WideOp = {
  And: 0b0000,
  BitClear: 0b0001,
  Or: 0b0010,
  OrNot: 0b0011,
  Xor: 0b0100,
  Pack: 0b0110,
  Add: 0b1000,
  AddCarry: 0b1010,
  SubtractCarry: 0b1011,
  Subtract: 0b1101,
  ReverseSubtract: 0b1110,
} as const;

/** Thumb-2 data processing (modified immediate or shifted register); Rd = PC with S selects the compare forms. */
export function wideData(
  op: number,
  s: boolean,
  rn: number,
  rd: number,
  operand: Operand,
  cond: number,
): Instruction {
  const test = rd === Register.PC && s;
  switch (op) {
    case WideOp.And:
      return test
        ? data(cond, DataOp.TST, true, rn, 0, operand)
        : data(cond, DataOp.AND, s, rn, rd, operand);
    case WideOp.BitClear:
      return data(cond, DataOp.BIC, s, rn, rd, operand);
    case WideOp.Or:
      return rn === Register.PC
        ? data(cond, DataOp.MOV, s, 0, rd, operand)
        : data(cond, DataOp.ORR, s, rn, rd, operand);
    case WideOp.OrNot:
      return rn === Register.PC
        ? data(cond, DataOp.MVN, s, 0, rd, operand)
        : data(cond, ThumbDataOp.ORN, s, rn, rd, operand);
    case WideOp.Xor:
      return test
        ? data(cond, DataOp.TEQ, true, rn, 0, operand)
        : data(cond, DataOp.EOR, s, rn, rd, operand);
    case WideOp.Pack:
      if (operand.kind !== "reg" || s) return unsupported(cond);
      return {
        cond,
        kind: "pack",
        top: operand.shift === ShiftType.ASR,
        rd,
        rn,
        rm: operand.rm,
        amount: operand.amount,
      };
    case WideOp.Add:
      return test
        ? data(cond, DataOp.CMN, true, rn, 0, operand)
        : data(cond, DataOp.ADD, s, rn, rd, operand);
    case WideOp.AddCarry:
      return data(cond, DataOp.ADC, s, rn, rd, operand);
    case WideOp.SubtractCarry:
      return data(cond, DataOp.SBC, s, rn, rd, operand);
    case WideOp.Subtract:
      return test
        ? data(cond, DataOp.CMP, true, rn, 0, operand)
        : data(cond, DataOp.SUB, s, rn, rd, operand);
    case WideOp.ReverseSubtract:
      return data(cond, DataOp.RSB, s, rn, rd, operand);
    default:
      return unsupported(cond);
  }
}
