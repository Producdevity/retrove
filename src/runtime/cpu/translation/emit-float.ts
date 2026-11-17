import { Double, Lanes, Single, Word } from "./emit-constants";
import { fail } from "./emit-state";
import type { Emitter } from "./emitter";
import type { VfpArithmetic } from "./vector-instruction";
import { BlockType, Op, Saturating, Type } from "./wasm-opcodes";

/** VFP/NEON state is cached as 32-bit lanes (S0..S63 view of D0..D31) in Wasm locals; only lanes this function uses. */
export function lane(e: Emitter, s: number): number {
  if (s >= Lanes.Architectural) {
    let scratch = e.scratchLanes.get(s);
    if (scratch === undefined) {
      scratch = e.c.local(Type.I32);
      e.scratchLanes.set(s, scratch);
    }
    return scratch;
  }
  const local = e.lanes.get(s);
  if (local === undefined) throw new Error("Lane " + s + " was not reserved");
  return local;
}

export function getLane(e: Emitter, s: number): void {
  e.c.get(lane(e, s));
}

export function setLane(e: Emitter, s: number): void {
  e.c.set(lane(e, s));
}

/** Pushes the lane's bits with flush-to-zero applied. */
export function flushedLane(e: Emitter, s: number): void {
  const local = lane(e, s);
  e.c.get(local).i32(Word.Sign).op(Op.I32And).get(local);
  e.c.get(local).i32(Single.Exponent).op(Op.I32And).op(Op.I32Eqz).op(Op.Select);
}

/** Replaces the single bits in `local` on the stack with the default NaN when they are a NaN. */
export function defaultNaN(e: Emitter, local: number): void {
  e.c.i32(Single.DefaultNaN).get(local).get(local).i32(1).op(Op.I32Shl);
  e.c.i32(Single.ShiftedInfinity).op(Op.I32GtU).op(Op.Select);
}

/** Converts the f64 in `value` to single bits, flushing tiny results and replacing NaN with the default NaN. */
export function demote(e: Emitter, value: number): void {
  const { c } = e;
  c.get(value).op(Op.F64Abs).f64(Single.FlushThreshold).op(Op.F64Lt).op(Op.If, Type.I32);
  c.get(value).f64(0).op(Op.F64Mul).op(Op.F32DemoteF64, Op.I32ReinterpretF32);
  c.op(Op.Else).i32(Single.DefaultNaN).get(value).op(Op.F32DemoteF64, Op.I32ReinterpretF32);
  c.get(value).get(value).op(Op.F64Ne).op(Op.Select).op(Op.End);
}

const singleOp = (op: VfpArithmetic) =>
  op === "add" ? Op.F32Add : op === "sub" ? Op.F32Sub : op === "div" ? Op.F32Div : Op.F32Mul;
const doubleOp = (op: VfpArithmetic) =>
  op === "add" ? Op.F64Add : op === "sub" ? Op.F64Sub : op === "div" ? Op.F64Div : Op.F64Mul;

/** Single-precision arithmetic with flush-to-zero and default NaN; operands are lane indices. */
export function singleArithmetic(
  e: Emitter,
  op: VfpArithmetic,
  d: number,
  n: number,
  m: number,
): void {
  const { c } = e,
    [a, b, r] = e.f,
    [, , , result] = e.t;
  const ia = lane(e, n),
    ib = lane(e, m);
  // Fast path: plain f32 arithmetic is exact unless an input is subnormal, or the result is subnormal, exactly the
  // smallest normal, or NaN. Shifting out the sign makes each test one unsigned range compare.
  c.get(ia).op(Op.F32ReinterpretI32).get(ib).op(Op.F32ReinterpretI32).op(singleOp(op));
  c.op(Op.I32ReinterpretF32).set(result);
  const below = (local: number, limit: number) =>
    c
      .get(local)
      .i32(1)
      .op(Op.I32Shl)
      .i32(Single.ShiftedBias)
      .op(Op.I32Sub)
      .i32(limit)
      .op(Op.I32LtU);
  below(ia, Single.ShiftedSubnormal);
  below(ib, Single.ShiftedSubnormal);
  c.op(Op.I32Or);
  below(result, Single.ShiftedTiny).op(Op.I32Or);
  c.get(result).i32(1).op(Op.I32Shl).i32(Single.ShiftedInfinity).op(Op.I32GtU).op(Op.I32Or);
  c.op(Op.If, BlockType.Empty);
  flushedLane(e, n);
  c.op(Op.F32ReinterpretI32, Op.F64PromoteF32).set(a);
  flushedLane(e, m);
  c.op(Op.F32ReinterpretI32, Op.F64PromoteF32).set(b);
  c.get(a).get(b).op(doubleOp(op)).set(r);
  // Flush-to-zero detects tininess before rounding; the double result classifies it exactly for these operations.
  demote(e, r);
  c.set(result);
  c.op(Op.End);
  c.get(result);
  if (op === "nmul") c.i32(Word.Sign).op(Op.I32Xor);
  setLane(e, d);
}

/** Pushes D register `d` as f64 with flush-to-zero applied to subnormal inputs. */
export function flushedDouble(e: Emitter, d: number): void {
  const { c } = e,
    [, bits] = e.x;
  getLane(e, Lanes.PerDouble * d + 1);
  c.op(Op.I64ExtendI32U).i64(Double.HighShift).op(Op.I64Shl);
  getLane(e, Lanes.PerDouble * d);
  c.op(Op.I64ExtendI32U).op(Op.I64Or).tee(bits);
  c.i64(Double.Sign).op(Op.I64And).get(bits).get(bits).i64(Double.Exponent).op(Op.I64And);
  c.op(Op.I64Eqz).op(Op.Select).op(Op.F64ReinterpretI64);
}

/** Stores an f64 on the stack into D register `d`, replacing NaN with the default NaN. */
export function storeDouble(e: Emitter, d: number): void {
  const { c } = e,
    [, , value] = e.f,
    [, bits] = e.x;
  c.set(value).i64(Double.DefaultNaN).get(value).op(Op.I64ReinterpretF64);
  c.get(value).get(value).op(Op.F64Ne).op(Op.Select).set(bits);
  c.get(bits).op(Op.I32WrapI64);
  setLane(e, Lanes.PerDouble * d);
  c.get(bits).i64(Double.HighShift).op(Op.I64ShrU).op(Op.I32WrapI64);
  setLane(e, Lanes.PerDouble * d + 1);
}

export function doubleArithmetic(
  e: Emitter,
  pc: number,
  op: VfpArithmetic,
  d: number,
  n: number,
  m: number,
): void {
  const { c } = e,
    [r] = e.f;
  flushedDouble(e, n);
  flushedDouble(e, m);
  c.op(doubleOp(op)).set(r);
  // A result at the smallest normal may have been tiny before rounding; the interpreter decides that case.
  // Inside an IT block an exit would lose ITSTATE; there the rounded result is kept (differs only when the exact
  // result was tiny but rounded up to the smallest normal).
  if (e.itStart === undefined) {
    c.get(r).op(Op.F64Abs).f64(Double.Minimum).op(Op.F64Eq).open(Op.If, "ambiguous");
    fail(e, () => c.i32(e.mode(pc)));
    c.end();
  }
  c.get(r).op(Op.F64Abs).f64(Double.Minimum).op(Op.F64Lt).op(Op.If, Type.F64);
  c.get(r).f64(0).op(Op.F64Mul).op(Op.Else).get(r).op(Op.End);
  if (op === "nmul") c.op(Op.F64Neg);
  storeDouble(e, d);
}

export function singleConvert(
  e: Emitter,
  toInt: boolean,
  signed: boolean,
  truncate: boolean,
  d: number,
  m: number,
): void {
  const { c } = e;
  if (toInt) {
    flushedLane(e, m);
    c.op(Op.F32ReinterpretI32);
    if (!truncate) c.op(Op.F32Nearest);
    c.saturating(signed ? Saturating.I32TruncSatF32S : Saturating.I32TruncSatF32U);
  } else {
    getLane(e, m);
    c.op(signed ? Op.F32ConvertI32S : Op.F32ConvertI32U, Op.I32ReinterpretF32);
  }
  setLane(e, d);
}
