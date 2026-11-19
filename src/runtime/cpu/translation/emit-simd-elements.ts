import { guest, hostAt, reg } from "./emit-access";
import { Lanes } from "./emit-constants";
import { getLane, setLane } from "./emit-float";
import { at } from "./emit-simd-float";
import { postIndex } from "./emit-simd-memory";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { Register, type InstructionOf } from "./instruction";
import { vectorLanes } from "./lanes";
import { Op } from "./wasm-opcodes";

const WORD_BITS = 32;
const WIDE_BITS = 64;
const WIDE_HIGH_SHIFT = 32n;
const SHIFT_BYTE = 24;
const PER_WIDE = 2;
const HALF_MASK = 0xffff;
const HALF_BYTES = 2;

/** Pushes element `j` of a lane, sign- or zero-extended to 32 bits. */
function element(e: Emitter, lane: number, bits: number, j: number, signed: boolean): void {
  const { c } = e;
  getLane(e, lane);
  if (bits === WORD_BITS) return;
  if (signed)
    c.i32(WORD_BITS - bits * (j + 1))
      .op(Op.I32Shl)
      .i32(WORD_BITS - bits)
      .op(Op.I32ShrS);
  else
    c.i32(bits * j)
      .op(Op.I32ShrU)
      .i32(((1 << bits) >>> 0) - 1)
      .op(Op.I32And);
}

/**
 * Applies `body` to each element of each 32-bit lane: the sources' elements are pushed in order
 * and `body` leaves the result; results are packed back into the destination lane.
 */
function perElement(
  e: Emitter,
  bits: number,
  destination: readonly number[],
  sources: readonly (readonly number[])[],
  signed: boolean,
  body: () => void,
): void {
  const { c } = e,
    [, , packed] = e.t;
  destination.forEach((lane, k) => {
    for (let j = 0; j < WORD_BITS / bits; j++) {
      for (const source of sources) element(e, source[k] ?? 0, bits, j, signed);
      body();
      if (bits === WORD_BITS) continue;
      c.i32(((1 << bits) >>> 0) - 1).op(Op.I32And);
      if (j)
        c.i32(bits * j)
          .op(Op.I32Shl)
          .get(packed)
          .op(Op.I32Or);
      c.set(packed);
    }
    if (bits !== WORD_BITS) c.get(packed);
    setLane(e, lane);
  });
}

const ArithmeticOp = { add: Op.I32Add, sub: Op.I32Sub, mul: Op.I32Mul } as const;

export function emitElementArithmetic(e: Emitter, i: InstructionOf<"velem">): void {
  const d = vectorLanes(i.d, i.q),
    n = vectorLanes(i.n, i.q),
    m = vectorLanes(i.m, i.q);
  if (i.op === "mla" || i.op === "mls") {
    const accumulate = i.op === "mla" ? Op.I32Add : Op.I32Sub;
    return perElement(e, i.bits, d, [d, n, m], false, () => e.c.op(Op.I32Mul).op(accumulate));
  }
  const op = ArithmeticOp[i.op];
  perElement(e, i.bits, d, [n, m], false, () => e.c.op(op));
}

/** Pushes the 64-bit element in lanes `low` and `low + 1`. */
function wideElement(e: Emitter, low: number): void {
  getLane(e, low + 1);
  e.c.op(Op.I64ExtendI32U).i64(WIDE_HIGH_SHIFT).op(Op.I64Shl);
  getLane(e, low);
  e.c.op(Op.I64ExtendI32U).op(Op.I64Or);
}
/** Stores the i64 on the stack into lanes `low` and `low + 1`. */
function storeWide(e: Emitter, low: number): void {
  const { c } = e,
    [value] = e.x;
  c.set(value).get(value).op(Op.I32WrapI64);
  setLane(e, low);
  c.get(value).i64(WIDE_HIGH_SHIFT).op(Op.I64ShrU).op(Op.I32WrapI64);
  setLane(e, low + 1);
}

function wideShift(e: Emitter, i: InstructionOf<"veshift">): void {
  const { c } = e,
    d = vectorLanes(i.d, i.q),
    m = vectorLanes(i.m, i.q);
  for (let k = 0; k < d.length; k += PER_WIDE) {
    if (i.op === "sra") wideElement(e, d[k] ?? 0);
    wideElement(e, m[k] ?? 0);
    if (i.op === "shl") c.i64(BigInt(i.amount)).op(Op.I64Shl);
    else if (i.unsigned && i.amount === WIDE_BITS) c.op(Op.Drop).i64(BigInt(0));
    else c.i64(BigInt(Math.min(i.amount, WIDE_BITS - 1))).op(i.unsigned ? Op.I64ShrU : Op.I64ShrS);
    if (i.op === "sra") c.op(Op.I64Add);
    storeWide(e, d[k] ?? 0);
  }
}

export function emitElementShift(e: Emitter, i: InstructionOf<"veshift">): void {
  if (i.bits === WIDE_BITS) return wideShift(e, i);
  const d = vectorLanes(i.d, i.q),
    m = vectorLanes(i.m, i.q),
    signed = !i.unsigned && i.op !== "shl";
  // Extended elements shift as 32-bit values; only a full 32-bit right shift needs clamping.
  const amount = Math.min(i.amount, WORD_BITS - 1),
    zero = i.unsigned && i.amount >= WORD_BITS;
  const shift = () => {
    if (i.op === "shl") e.c.i32(i.amount).op(Op.I32Shl);
    else if (zero) e.c.op(Op.Drop).i32(0);
    else e.c.i32(amount).op(signed ? Op.I32ShrS : Op.I32ShrU);
  };
  if (i.op === "sra")
    return perElement(e, i.bits, d, [d, m], signed, () => {
      shift();
      e.c.op(Op.I32Add);
    });
  perElement(e, i.bits, d, [m], signed, shift);
}

/** VSHL (register) on 64-bit elements; the shift is the signed low byte of n's element. */
export function emitWideShiftRegister(e: Emitter, i: InstructionOf<"vshlreg64">): void {
  const { c } = e,
    [shift] = e.t,
    [value] = e.x,
    d = vectorLanes(i.d, i.q),
    n = vectorLanes(i.n, i.q),
    m = vectorLanes(i.m, i.q);
  for (let k = 0; k < d.length; k += PER_WIDE) {
    getLane(e, n[k] ?? 0);
    c.i32(SHIFT_BYTE).op(Op.I32Shl).i32(SHIFT_BYTE).op(Op.I32ShrS).set(shift);
    wideElement(e, m[k] ?? 0);
    c.set(value);
    // Left: v << s, or 0 from 64 up.
    c.i64(BigInt(0)).get(value).get(shift).op(Op.I64ExtendI32S).op(Op.I64Shl);
    c.get(shift).i32(WIDE_BITS).op(Op.I32LtS).op(Op.Select);
    // Right by -s: unsigned gives 0 from 64 up, signed saturates at 63.
    c.get(value).i32(0).get(shift).op(Op.I32Sub);
    if (i.unsigned) {
      c.op(Op.I64ExtendI32S).op(Op.I64ShrU).i64(BigInt(0));
      c.i32(0).get(shift).op(Op.I32Sub).i32(WIDE_BITS).op(Op.I32LtS).op(Op.Select);
    } else {
      c.i32(WIDE_BITS - 1)
        .i32(0)
        .get(shift)
        .op(Op.I32Sub)
        .i32(WIDE_BITS - 1)
        .op(Op.I32GtS);
      c.op(Op.Select).op(Op.I64ExtendI32S).op(Op.I64ShrS);
    }
    c.get(shift).i32(0).op(Op.I32GeS).op(Op.Select);
    storeWide(e, d[k] ?? 0);
  }
}

const NARROW_SOURCES = 4;
const HALF_BITS = 16;

/** Narrowing right shift: every source element (twice `bits` wide) of Qm into Dd. */
export function emitShiftNarrow(e: Emitter, i: InstructionOf<"vshrn">): void {
  const { c } = e,
    [, , packed] = e.t,
    sourceBits = PER_WIDE * i.bits,
    perSource = WORD_BITS / sourceBits,
    perWord = WORD_BITS / i.bits,
    mask = ((1 << i.bits) >>> 0) - 1;
  for (let k = 0; k < NARROW_SOURCES; k++) {
    getLane(e, at(i.m, k));
    c.set(e.laneTemp(k));
  }
  for (let word = 0; word < NARROW_SOURCES / PER_WIDE; word++) {
    for (let j = 0; j < perWord; j++) {
      const index = word * perWord + j,
        offset = (index % perSource) * sourceBits;
      c.get(e.laneTemp(Math.floor(index / perSource)));
      c.i32(offset).op(Op.I32ShrU);
      if (sourceBits < WORD_BITS) c.i32((1 << sourceBits) - 1).op(Op.I32And);
      if (i.round) c.i32(1 << (i.amount - 1)).op(Op.I32Add);
      c.i32(i.amount).op(Op.I32ShrU).i32(mask).op(Op.I32And);
      if (j)
        c.i32(i.bits * j)
          .op(Op.I32Shl)
          .get(packed)
          .op(Op.I32Or);
      c.set(packed);
    }
    c.get(packed);
    setLane(e, at(i.d, word));
  }
}

export function emitHalfLane(e: Emitter, pc: number, i: InstructionOf<"vlane16">): void {
  const { c } = e,
    [base, address] = e.t,
    lane = Lanes.PerDouble * i.d + (i.index >> 1),
    shift = (i.index & 1) * HALF_BITS;
  if (i.rn === Register.PC) return emitUnsupported(e, pc);
  reg(e, i.rn, pc);
  c.tee(base).set(address);
  hostAt(e, address, 0);
  if (i.load) {
    guest(e, Op.I32Load16U);
    c.i32(shift).op(Op.I32Shl);
    getLane(e, lane);
    c.i32(~(HALF_MASK << shift))
      .op(Op.I32And)
      .op(Op.I32Or);
    setLane(e, lane);
  } else {
    getLane(e, lane);
    c.i32(shift).op(Op.I32ShrU);
    guest(e, Op.I32Store16);
  }
  postIndex(e, pc, base, i.rn, i.rm, HALF_BYTES);
}
