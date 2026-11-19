import { getLane, setLane } from "./emit-float";
import { at } from "./emit-simd-float";
import type { Emitter } from "./emitter";
import type { InstructionOf } from "./instruction";
import { vectorLanes } from "./lanes";
import { Op, Saturating } from "./wasm-opcodes";

const SOURCE_LANES = 4;
const BYTE_BITS = 8;
const WORD_BITS = 32;
/** Narrowed elements come from sources twice as wide. */
const WIDENING = 2;
const FIXED_RADIX = 2;
/** Two 16-bit results pack into each destination word. */
const PER_WORD = 2;

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

/** Pushes the element in `local` (already extended to 32 bits) clamped to the result range. */
function saturate(e: Emitter, local: number, i: InstructionOf<"vqmovn">): void {
  const { c } = e,
    [clamped] = e.t,
    bits = BYTE_BITS * i.bytes,
    high = i.signedResult ? (1 << (bits - 1)) - 1 : (1 << bits) - 1,
    low = i.signedResult ? -(1 << (bits - 1)) : 0;
  if (!i.saturate) return void c.get(local);
  if (i.signedSource) {
    c.i32(low).get(local).get(local).i32(low).op(Op.I32LtS).op(Op.Select);
    c.set(clamped);
  } else c.get(local).set(clamped);
  const above = i.signedSource ? Op.I32GtS : Op.I32GtU;
  c.i32(high).get(clamped).get(clamped).i32(high).op(above).op(Op.Select);
}

/** Narrows the four source words: each holds 4 / bytes elements of twice `bytes` width. */
export function emitSaturatingNarrow(e: Emitter, i: InstructionOf<"vqmovn">): void {
  const { c } = e,
    [, element] = e.t,
    sourceBits = WIDENING * BYTE_BITS * i.bytes,
    perSource = WORD_BITS / sourceBits,
    resultBits = BYTE_BITS * i.bytes,
    perWord = WORD_BITS / resultBits;
  for (let k = 0; k < SOURCE_LANES; k++) {
    getLane(e, at(i.m, k));
    c.set(e.laneTemp(k));
  }
  for (let word = 0; word < SOURCE_LANES / PER_WORD; word++) {
    for (let k = 0; k < perWord; k++) {
      const index = word * perWord + k,
        source = e.laneTemp(Math.floor(index / perSource)),
        offset = (index % perSource) * sourceBits;
      c.get(source)
        .i32(WORD_BITS - offset - sourceBits)
        .op(Op.I32Shl);
      c.i32(WORD_BITS - sourceBits)
        .op(i.signedSource ? Op.I32ShrS : Op.I32ShrU)
        .set(element);
      saturate(e, element, i);
      c.i32((1 << resultBits) - 1).op(Op.I32And);
      if (k)
        c.i32(k * resultBits)
          .op(Op.I32Shl)
          .op(Op.I32Or);
    }
    setLane(e, at(i.d, word));
  }
}

const ZeroCompare = {
  gt: Op.I32GtS,
  ge: Op.I32GeS,
  eq: Op.I32Eq,
  le: Op.I32LeS,
  lt: Op.I32LtS,
} as const;

export function emitZeroCompare(e: Emitter, i: InstructionOf<"vizero">): void {
  const m = vectorLanes(i.m, i.q);
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    e.c.i32(0);
    getLane(e, m[k] ?? 0);
    e.c.i32(0).op(ZeroCompare[i.op]).op(Op.I32Sub);
    setLane(e, lane);
  });
}

export function emitFixedConvert(e: Emitter, i: InstructionOf<"vcvtfixed">): void {
  const { c } = e,
    m = vectorLanes(i.m, i.q),
    scale = FIXED_RADIX ** i.fraction;
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    getLane(e, m[k] ?? 0);
    if (i.toFixed) {
      c.op(Op.F32ReinterpretI32, Op.F64PromoteF32).f64(scale).op(Op.F64Mul);
      c.saturating(i.unsigned ? Saturating.I32TruncSatF64U : Saturating.I32TruncSatF64S);
    } else {
      c.op(i.unsigned ? Op.F64ConvertI32U : Op.F64ConvertI32S)
        .f64(1 / scale)
        .op(Op.F64Mul);
      c.op(Op.F32DemoteF64, Op.I32ReinterpretF32);
    }
    setLane(e, lane);
  });
}

const HALF_BITS = 16;

/** Each 16-bit element of Dm, extended to 32 bits, added to (or taken from) a lane of Qn. */
export function emitWidenAdd(e: Emitter, i: InstructionOf<"vaddw">): void {
  const { c } = e;
  for (let k = 0; k < PER_WORD; k++) {
    getLane(e, at(i.m, k));
    c.set(e.laneTemp(k));
  }
  for (let k = 0; k < SOURCE_LANES; k++) {
    getLane(e, at(i.n, k));
    c.get(e.laneTemp(Math.floor(k / PER_WORD)));
    c.i32(k % PER_WORD ? 0 : HALF_BITS).op(Op.I32Shl);
    c.i32(HALF_BITS).op(i.unsigned ? Op.I32ShrU : Op.I32ShrS);
    c.op(i.sub ? Op.I32Sub : Op.I32Add);
    setLane(e, at(i.d, k));
  }
}

const WIDE_HIGH_SHIFT = 32n;

/** Pushes the 64-bit element in lanes `low` and `low + 1`. */
function wideElement(e: Emitter, low: number): void {
  getLane(e, low + 1);
  e.c.op(Op.I64ExtendI32U).i64(WIDE_HIGH_SHIFT).op(Op.I64Shl);
  getLane(e, low);
  e.c.op(Op.I64ExtendI32U).op(Op.I64Or);
}

export function emitWideArithmetic(e: Emitter, i: InstructionOf<"viarith64">): void {
  const { c } = e,
    [value] = e.x,
    n = vectorLanes(i.n, i.q),
    m = vectorLanes(i.m, i.q),
    d = vectorLanes(i.d, i.q);
  for (let k = 0; k < d.length; k += PER_WORD) {
    wideElement(e, n[k] ?? 0);
    wideElement(e, m[k] ?? 0);
    c.op(i.sub ? Op.I64Sub : Op.I64Add).set(value);
    c.get(value).op(Op.I32WrapI64);
    setLane(e, d[k] ?? 0);
    c.get(value).i64(WIDE_HIGH_SHIFT).op(Op.I64ShrU).op(Op.I32WrapI64);
    setLane(e, (d[k] ?? 0) + 1);
  }
}
