import { guest, hostAt, reg } from "./emit-access";
import { Lanes, Word } from "./emit-constants";
import {
  demote,
  defaultNaN,
  doubleArithmetic,
  flushedDouble,
  flushedLane,
  getLane,
  setLane,
  singleArithmetic,
  singleConvert,
  storeDouble,
} from "./emit-float";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { Register, type InstructionOf } from "./instruction";
import { Op, Saturating } from "./wasm-opcodes";

const LowWord = 0xffffffffn;
const HighShift = 32n;

/** Loads or stores consecutive lanes at the host address of `address + 4k`. */
export function transferLanes(
  e: Emitter,
  load: boolean,
  address: number,
  lanes: readonly number[],
): void {
  lanes.forEach((lane, k) => {
    hostAt(e, address, Word.Bytes * k);
    if (load) {
      guest(e, Op.I32Load);
      setLane(e, lane);
    } else {
      getLane(e, lane);
      guest(e, Op.I32Store);
    }
  });
}

export function emitVfpMemory(e: Emitter, pc: number, i: InstructionOf<"vmem">): void {
  const { c } = e,
    [address] = e.t;
  const lanes = i.double ? [Lanes.PerDouble * i.vd, Lanes.PerDouble * i.vd + 1] : [i.vd];
  if (i.rn === Register.PC && i.load) {
    const literal = e.literalBase(pc) + i.offset;
    const words = lanes.map((_, k) => {
      const at = literal + Word.Bytes * k;
      return e.input.isCode(at) ? e.input.readWord(at) : undefined;
    });
    if (words.every((w) => w !== undefined)) {
      lanes.forEach((lane, k) => {
        c.i32(words[k] ?? 0);
        setLane(e, lane);
      });
      return;
    }
  }
  if (i.rn === Register.PC) c.i32(e.literalBase(pc));
  else reg(e, i.rn, pc);
  c.i32(i.offset).op(Op.I32Add).set(address);
  transferLanes(e, i.load, address, lanes);
}

export function emitVfpMultiple(e: Emitter, pc: number, i: InstructionOf<"vmulti">): void {
  const { c } = e,
    [base, address] = e.t;
  if (i.rn === Register.PC) return emitUnsupported(e, pc);
  const lanes = i.double
    ? Array.from({ length: Lanes.PerDouble * i.count }, (_, k) => Lanes.PerDouble * i.first + k)
    : Array.from({ length: i.count }, (_, k) => i.first + k);
  const span = Word.Bytes * lanes.length;
  reg(e, i.rn, pc);
  c.tee(base);
  if (!i.increment) c.i32(span).op(Op.I32Sub);
  c.set(address);
  transferLanes(e, i.load, address, lanes);
  if (i.writeback)
    c.get(base)
      .i32(i.increment ? span : -span)
      .op(Op.I32Add)
      .set(e.register(i.rn));
}

export function emitVfpArithmetic(e: Emitter, pc: number, i: InstructionOf<"varith">): void {
  if (i.double) doubleArithmetic(e, pc, i.op, i.d, i.n, i.m);
  else singleArithmetic(e, i.op, i.d, i.n, i.m);
}

export function emitPrecision(e: Emitter, i: InstructionOf<"vcvtfd">): void {
  const { c } = e,
    [value] = e.f,
    [result] = e.t;
  if (i.toDouble) {
    flushedLane(e, i.m);
    c.op(Op.F32ReinterpretI32, Op.F64PromoteF32);
    storeDouble(e, i.d);
    return;
  }
  flushedDouble(e, i.m);
  c.set(value);
  demote(e, value);
  c.set(result);
  c.get(result);
  setLane(e, i.d);
}

function signOp(e: Emitter, op: InstructionOf<"vunary">["op"]): void {
  if (op === "neg") e.c.i32(Word.Sign).op(Op.I32Xor);
  else if (op === "abs") e.c.i32(Word.Magnitude).op(Op.I32And);
}

export function emitVfpUnary(e: Emitter, i: InstructionOf<"vunary">): void {
  const { c } = e,
    [result] = e.t,
    temp = e.laneTemp(0);
  if (i.op === "sqrt") {
    // Square roots of normal inputs are never subnormal, so only the flushed input and NaN need handling.
    if (i.double) {
      flushedDouble(e, i.m);
      c.op(Op.F64Sqrt);
      storeDouble(e, i.d);
      return;
    }
    flushedLane(e, i.m);
    c.op(Op.F32ReinterpretI32, Op.F32Sqrt, Op.I32ReinterpretF32).set(result);
    defaultNaN(e, result);
    setLane(e, i.d);
    return;
  }
  if (!i.double) {
    getLane(e, i.m);
    signOp(e, i.op);
    setLane(e, i.d);
    return;
  }
  getLane(e, Lanes.PerDouble * i.m);
  c.set(temp);
  getLane(e, Lanes.PerDouble * i.m + 1);
  signOp(e, i.op);
  setLane(e, Lanes.PerDouble * i.d + 1);
  c.get(temp);
  setLane(e, Lanes.PerDouble * i.d);
}

export function emitVfpImmediate(e: Emitter, i: InstructionOf<"vmovimm">): void {
  if (i.double) {
    e.c.i32(Number(i.bits & LowWord));
    setLane(e, Lanes.PerDouble * i.d);
    e.c.i32(Number(i.bits >> HighShift));
    setLane(e, Lanes.PerDouble * i.d + 1);
  } else {
    e.c.i32(Number(i.bits));
    setLane(e, i.d);
  }
}

/** VCMP sets the FPSCR flags: less gives N, equal gives Z and C, unordered gives C and V. */
export function emitVfpCompare(e: Emitter, i: InstructionOf<"vcmp">): void {
  const { c } = e,
    [a, b] = e.f,
    [lt, eq, gt] = e.t,
    fp = e.fpFlags;
  if (i.double) {
    flushedDouble(e, i.d);
    c.set(a);
    if (i.m === undefined) c.f64(0);
    else flushedDouble(e, i.m);
  } else {
    flushedLane(e, i.d);
    c.op(Op.F32ReinterpretI32, Op.F64PromoteF32).set(a);
    if (i.m === undefined) c.f64(0);
    else {
      flushedLane(e, i.m);
      c.op(Op.F32ReinterpretI32, Op.F64PromoteF32);
    }
  }
  c.set(b);
  c.get(a).get(b).op(Op.F64Lt).set(lt).get(a).get(b).op(Op.F64Eq).set(eq);
  c.get(a).get(b).op(Op.F64Gt).set(gt);
  c.get(lt).set(fp.n).get(eq).set(fp.z).get(lt).op(Op.I32Eqz).set(fp.c);
  c.get(lt).get(eq).op(Op.I32Or).get(gt).op(Op.I32Or).op(Op.I32Eqz).set(fp.v);
}

export function emitVfpConvert(e: Emitter, i: InstructionOf<"vcvt">): void {
  const { c } = e;
  if (!i.double) return singleConvert(e, i.toInt, i.signed, i.truncate, i.d, i.m);
  if (i.toInt) {
    flushedDouble(e, i.m);
    if (!i.truncate) c.op(Op.F64Nearest);
    c.saturating(i.signed ? Saturating.I32TruncSatF64S : Saturating.I32TruncSatF64U);
    setLane(e, i.d);
  } else {
    getLane(e, i.m);
    c.op(i.signed ? Op.F64ConvertI32S : Op.F64ConvertI32U);
    storeDouble(e, i.d);
  }
}
