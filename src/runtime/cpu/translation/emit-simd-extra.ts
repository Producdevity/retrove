import { getLane, setLane } from "./emit-float";
import { at } from "./emit-simd-float";
import type { Emitter } from "./emitter";
import type { InstructionOf } from "./instruction";
import { vectorLanes } from "./lanes";
import { Op } from "./wasm-opcodes";

const SOURCE_LANES = 4;
/** Two 16-bit results pack into each destination word. */
const PER_WORD = 2;
const HALF_BITS = 16;
const HALF_MASK = 0xffff;
const Range = {
  Signed: { low: -0x8000, high: 0x7fff },
  Unsigned: { low: 0, high: 0xffff },
} as const;

export function emitIntegerOrder(e: Emitter, i: InstructionOf<"viorder">): void {
  const n = vectorLanes(i.n, i.q),
    m = vectorLanes(i.m, i.q);
  const compare = i.ge ? (i.unsigned ? Op.I32GeU : Op.I32GeS) : i.unsigned ? Op.I32GtU : Op.I32GtS;
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    e.c.i32(0);
    getLane(e, n[k] ?? 0);
    getLane(e, m[k] ?? 0);
    e.c.op(compare).op(Op.I32Sub);
    setLane(e, lane);
  });
}

export function emitVectorNot(e: Emitter, i: InstructionOf<"vmvn">): void {
  const m = vectorLanes(i.m, i.q);
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    getLane(e, m[k] ?? 0);
    e.c.i32(-1).op(Op.I32Xor);
    setLane(e, lane);
  });
}

export function emitShiftImmediate(e: Emitter, i: InstructionOf<"vshli">): void {
  const m = vectorLanes(i.m, i.q);
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    getLane(e, m[k] ?? 0);
    e.c.i32(i.amount).op(Op.I32Shl);
    setLane(e, lane);
  });
}

/** Pushes `local` clamped to the 16-bit result range. */
function saturate(e: Emitter, local: number, i: InstructionOf<"vqmovn">): void {
  const { c } = e,
    [clamped] = e.t,
    range = i.signedResult ? Range.Signed : Range.Unsigned;
  if (i.signedSource) {
    c.i32(range.low).get(local).get(local).i32(range.low).op(Op.I32LtS).op(Op.Select);
    c.set(clamped);
  } else c.get(local).set(clamped);
  const above = i.signedSource ? Op.I32GtS : Op.I32GtU;
  c.i32(range.high).get(clamped).get(clamped).i32(range.high).op(above).op(Op.Select);
}

export function emitSaturatingNarrow(e: Emitter, i: InstructionOf<"vqmovn">): void {
  const { c } = e;
  for (let k = 0; k < SOURCE_LANES; k++) {
    getLane(e, at(i.m, k));
    c.set(e.laneTemp(k));
  }
  for (let k = 0; k < SOURCE_LANES / PER_WORD; k++) {
    saturate(e, e.laneTemp(PER_WORD * k), i);
    c.i32(HALF_MASK).op(Op.I32And);
    saturate(e, e.laneTemp(PER_WORD * k + 1), i);
    c.i32(HALF_BITS).op(Op.I32Shl).op(Op.I32Or);
    setLane(e, at(i.d, k));
  }
}
