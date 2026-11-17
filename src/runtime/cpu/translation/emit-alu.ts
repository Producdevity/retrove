import { reg, setNZ } from "./emit-access";
import { Double, Word } from "./emit-constants";
import { jumpTo } from "./emit-control";
import { operand } from "./emit-shift";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { DataOp, Register, ThumbDataOp, type InstructionOf } from "./instruction";
import { Op } from "./wasm-opcodes";

const LogicalOps = new Set<number>([
  DataOp.AND,
  DataOp.EOR,
  DataOp.TST,
  DataOp.TEQ,
  DataOp.ORR,
  DataOp.MOV,
  DataOp.BIC,
  DataOp.MVN,
  ThumbDataOp.ORN,
]);
const CarryOne = 1n;

type CarryIn = "zero" | "one" | "flag";

/** Emits `x + (invert ? ~y : y) + carry` through i64 so the carry and overflow fall out of the sum. */
function addWithCarry(
  e: Emitter,
  setFlags: boolean,
  x: number,
  y: number,
  carryIn: CarryIn,
  invertY: boolean,
): void {
  const { c } = e,
    { c: cf, v: vf } = e.flags,
    [, , res] = e.t,
    [sum] = e.x;
  c.get(x).op(Op.I64ExtendI32U).get(y);
  if (invertY) c.i32(-1).op(Op.I32Xor);
  c.op(Op.I64ExtendI32U).op(Op.I64Add);
  if (carryIn === "one") c.i64(CarryOne).op(Op.I64Add);
  else if (carryIn === "flag") c.get(cf).op(Op.I64ExtendI32U).op(Op.I64Add);
  c.set(sum).get(sum).op(Op.I32WrapI64).set(res);
  if (!setFlags) return;
  c.get(sum).i64(Double.HighShift).op(Op.I64ShrU).op(Op.I32WrapI64).set(cf);
  c.get(x).get(res).op(Op.I32Xor).get(y);
  if (invertY) c.i32(-1).op(Op.I32Xor);
  c.get(res).op(Op.I32Xor).op(Op.I32And).i32(Word.SignShift).op(Op.I32ShrU).set(vf);
}

/** Computes the data-processing result into `res`. */
function compute(e: Emitter, op: number, setFlags: boolean): void {
  const { c } = e,
    [a, b, res] = e.t;
  const add = (x: number, y: number, carryIn: CarryIn, invertY: boolean) =>
    addWithCarry(e, setFlags, x, y, carryIn, invertY);
  switch (op) {
    case DataOp.AND:
    case DataOp.TST:
      c.get(a).get(b).op(Op.I32And).set(res);
      break;
    case DataOp.EOR:
    case DataOp.TEQ:
      c.get(a).get(b).op(Op.I32Xor).set(res);
      break;
    case DataOp.ORR:
      c.get(a).get(b).op(Op.I32Or).set(res);
      break;
    case DataOp.BIC:
      c.get(a).get(b).i32(-1).op(Op.I32Xor).op(Op.I32And).set(res);
      break;
    case ThumbDataOp.ORN:
      c.get(a).get(b).i32(-1).op(Op.I32Xor).op(Op.I32Or).set(res);
      break;
    case DataOp.MOV:
      c.get(b).set(res);
      break;
    case DataOp.MVN:
      c.get(b).i32(-1).op(Op.I32Xor).set(res);
      break;
    case DataOp.ADD:
    case DataOp.CMN:
      return add(a, b, "zero", false);
    case DataOp.ADC:
      return add(a, b, "flag", false);
    case DataOp.SUB:
    case DataOp.CMP:
      return add(a, b, "one", true);
    case DataOp.SBC:
      return add(a, b, "flag", true);
    case DataOp.RSB:
      return add(b, a, "one", true);
    default:
      return add(b, a, "flag", true);
  }
}

export function emitData(e: Emitter, pc: number, i: InstructionOf<"data">): void {
  const { c } = e,
    [a, b, res, carry] = e.t;
  if (i.rd === Register.PC && i.s) return emitUnsupported(e, pc);
  const logical = LogicalOps.has(i.op);
  const usesRn = i.op !== DataOp.MOV && i.op !== DataOp.MVN;
  const compare = i.op >= DataOp.TST && i.op <= DataOp.CMN;
  const setFlags = i.s || compare;
  if (usesRn) {
    reg(e, i.rn, pc);
    c.set(a);
  }
  operand(e, i.operand, pc, setFlags && logical ? carry : undefined);
  c.set(b);
  compute(e, i.op, setFlags);
  if (setFlags) {
    setNZ(e, res);
    if (logical) c.get(carry).set(e.flags.c);
  }
  if (compare) return;
  if (i.rd === Register.PC) {
    // Thumb ADD/MOV to PC stay in Thumb state; ARM state data-processing writes interwork.
    if (e.thumb) c.get(res).i32(1).op(Op.I32Or).set(res);
    const value = i.operand;
    const isReturn =
      i.op === DataOp.MOV &&
      value.kind === "reg" &&
      value.rm === Register.LR &&
      value.amount === 0 &&
      value.shift === 0;
    return jumpTo(e, res, isReturn ? "return" : "indirect");
  }
  c.get(res).set(e.register(i.rd));
}
