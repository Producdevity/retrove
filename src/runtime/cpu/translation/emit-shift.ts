import { reg } from "./emit-access";
import { Word } from "./emit-constants";
import type { Emitter } from "./emitter";
import { ShiftType, type MemoryOffset, type Operand } from "./instruction";
import { BlockType, Op } from "./wasm-opcodes";

/** Register-specified shifts of 32 clear the value; of 33 or more also clear the carry. */
const CarryLimit = Word.Bits + 1;

/** Pushes the shifted register value; stores the shifter carry in `carry` when given. */
export function shifted(
  e: Emitter,
  rm: number,
  shift: number,
  amount: number,
  pc: number,
  carry?: number,
): void {
  const { c } = e,
    cf = e.flags.c,
    [, , , , , , src] = e.t;
  reg(e, rm, pc);
  c.set(src);
  const carryBit = (position: number) => {
    if (carry !== undefined)
      c.get(src).i32(position).op(Op.I32ShrU).i32(1).op(Op.I32And).set(carry);
  };
  switch (shift) {
    case ShiftType.LSL:
      if (amount === 0) {
        if (carry !== undefined) c.get(cf).set(carry);
        c.get(src);
      } else {
        carryBit(Word.Bits - amount);
        c.get(src).i32(amount).op(Op.I32Shl);
      }
      break;
    case ShiftType.LSR:
      if (amount === 0) {
        carryBit(Word.SignShift);
        c.i32(0);
      } else {
        carryBit(amount - 1);
        c.get(src).i32(amount).op(Op.I32ShrU);
      }
      break;
    case ShiftType.ASR:
      carryBit(amount === 0 ? Word.SignShift : amount - 1);
      c.get(src)
        .i32(amount === 0 ? Word.SignShift : amount)
        .op(Op.I32ShrS);
      break;
    default:
      if (amount === 0) {
        carryBit(0);
        c.get(cf).i32(Word.SignShift).op(Op.I32Shl).get(src).i32(1).op(Op.I32ShrU).op(Op.I32Or);
      } else {
        carryBit(amount - 1);
        c.get(src).i32(amount).op(Op.I32Rotr);
      }
  }
}

export function operand(e: Emitter, value: Operand, pc: number, carry?: number): void {
  if (value.kind === "imm") {
    e.c.i32(value.value);
    if (carry !== undefined) {
      if (value.carry === undefined) e.c.get(e.flags.c).set(carry);
      else e.c.i32(value.carry).set(carry);
    }
  } else if (value.kind === "reg") shifted(e, value.rm, value.shift, value.amount, pc, carry);
  else registerShift(e, value.rm, value.shift, value.rs, pc, carry);
}

/** Shift by the low byte of a register, with ARM's rules for amounts of 0, 32 and above. */
function registerShift(
  e: Emitter,
  rm: number,
  shift: number,
  rs: number,
  pc: number,
  carry?: number,
): void {
  const { c } = e,
    cf = e.flags.c,
    [, , , , , result, value, amount] = e.t;
  reg(e, rm, pc);
  c.set(value);
  reg(e, rs, pc);
  c.i32(Word.Byte).op(Op.I32And).set(amount);
  const bitAt = (position: () => void) => {
    c.get(value);
    position();
    c.op(Op.I32ShrU).i32(1).op(Op.I32And);
  };
  const below = (limit: number) => c.get(amount).i32(limit).op(Op.I32LtU).op(Op.Select);
  c.get(amount).op(Op.I32Eqz).op(Op.If, BlockType.Empty).get(value).set(result);
  if (carry !== undefined) c.get(cf).set(carry);
  c.op(Op.Else);
  switch (shift) {
    case ShiftType.LSL:
      c.get(value).get(amount).op(Op.I32Shl).i32(0);
      below(Word.Bits).set(result);
      if (carry !== undefined) {
        bitAt(() => c.i32(Word.Bits).get(amount).op(Op.I32Sub));
        c.i32(0);
        below(CarryLimit).set(carry);
      }
      break;
    case ShiftType.LSR:
      c.get(value).get(amount).op(Op.I32ShrU).i32(0);
      below(Word.Bits).set(result);
      if (carry !== undefined) {
        bitAt(() => c.get(amount).i32(1).op(Op.I32Sub));
        c.i32(0);
        below(CarryLimit).set(carry);
      }
      break;
    case ShiftType.ASR:
      c.get(value).get(amount).i32(Word.SignShift);
      below(Word.Bits).op(Op.I32ShrS).set(result);
      if (carry !== undefined) {
        bitAt(() => {
          c.get(amount).i32(1).op(Op.I32Sub).i32(Word.SignShift);
          below(CarryLimit);
        });
        c.set(carry);
      }
      break;
    default:
      c.get(value).get(amount).op(Op.I32Rotr).set(result);
      if (carry !== undefined) {
        bitAt(() => c.get(amount).i32(1).op(Op.I32Sub).i32(Word.SignShift).op(Op.I32And));
        c.set(carry);
      }
  }
  c.op(Op.End);
  c.get(result);
}

export function offset(e: Emitter, value: MemoryOffset, pc: number): void {
  if (value.kind === "imm") e.c.i32(value.value);
  else shifted(e, value.rm, value.shift, value.amount, pc);
}
