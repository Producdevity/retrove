import { reg } from "./emit-access";
import { Lanes, Word } from "./emit-constants";
import { getLane, setLane } from "./emit-float";
import { at, elements } from "./emit-simd-float";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { AccessBytes, type InstructionOf } from "./instruction";
import { vectorLanes } from "./lanes";
import { Op } from "./wasm-opcodes";

const LowWord = 0xffffffffn;
const LaneShift = 2;
const ByteMask = 3;
const NarrowSources = 4;

export function emitLogic(e: Emitter, i: InstructionOf<"vlogic">): void {
  const { c } = e;
  const d = vectorLanes(i.d, i.q),
    n = vectorLanes(i.n, i.q),
    m = vectorLanes(i.m, i.q);
  d.forEach((lane, k) => {
    const nk = n[k] ?? 0,
      mk = m[k] ?? 0;
    if (i.op === "bsl" || i.op === "bit" || i.op === "bif") {
      // Bitwise select: selector ? first : second.
      const [selector, first, second] =
        i.op === "bsl" ? [lane, nk, mk] : i.op === "bit" ? [mk, nk, lane] : [mk, lane, nk];
      getLane(e, first);
      getLane(e, selector);
      c.op(Op.I32And);
      getLane(e, second);
      getLane(e, selector);
      c.i32(-1).op(Op.I32Xor).op(Op.I32And).op(Op.I32Or);
      setLane(e, lane);
      return;
    }
    getLane(e, nk);
    getLane(e, mk);
    if (i.op === "bic" || i.op === "orn") c.i32(-1).op(Op.I32Xor);
    c.op(i.op === "and" || i.op === "bic" ? Op.I32And : i.op === "eor" ? Op.I32Xor : Op.I32Or);
    setLane(e, lane);
  });
}

export function emitVectorImmediate(e: Emitter, i: InstructionOf<"vmovi">): void {
  vectorLanes(i.d, i.q).forEach((lane, k) => {
    e.c.i32(Number((i.value >> BigInt(Word.Bits * (k & 1))) & LowWord));
    setLane(e, lane);
  });
}

/** VMOVL: widens each element of D m into Q d. */
export function emitLengthen(e: Emitter, i: InstructionOf<"vmovl">): void {
  const { c } = e;
  getLane(e, at(i.m, 0));
  c.set(e.laneTemp(0));
  getLane(e, at(i.m, 1));
  c.set(e.laneTemp(1));
  const out = vectorLanes(i.d, true);
  const part = (source: number, bit: number, width: number) => {
    c.get(e.laneTemp(source));
    if (i.signed)
      c.i32(Word.Bits - bit - width)
        .op(Op.I32Shl)
        .i32(Word.Bits - width)
        .op(Op.I32ShrS);
    else {
      if (bit) c.i32(bit).op(Op.I32ShrU);
      if (width < Word.Bits) c.i32(((1 << width) >>> 0) - 1).op(Op.I32And);
    }
  };
  out.forEach((lane, k) => {
    const source = k >> 1,
      low = Word.HalfBits * (k & 1);
    if (i.bytes === AccessBytes.Half) part(source, low, Word.HalfBits);
    else if (i.bytes === AccessBytes.Byte) {
      part(source, low, Word.ByteBits);
      if (i.signed) c.i32(Word.Half).op(Op.I32And);
      part(source, low + Word.ByteBits, Word.ByteBits);
      c.i32(Word.HalfBits).op(Op.I32Shl).op(Op.I32Or);
    } else if (k & 1) {
      if (i.signed) c.get(e.laneTemp(source)).i32(Word.SignShift).op(Op.I32ShrS);
      else c.i32(0);
    } else c.get(e.laneTemp(source));
    setLane(e, lane);
  });
}

export function emitVectorExtract(e: Emitter, i: InstructionOf<"vext">): void {
  const { c } = e;
  const all = [...vectorLanes(i.n, i.q), ...vectorLanes(i.m, i.q)],
    out = vectorLanes(i.d, i.q);
  all.forEach((lane, k) => {
    getLane(e, lane);
    c.set(e.laneTemp(k));
  });
  const offset = i.imm >> LaneShift,
    shift = (i.imm & ByteMask) * Word.ByteBits;
  out.forEach((lane, k) => {
    c.get(e.laneTemp(k + offset));
    if (shift) {
      c.i32(shift)
        .op(Op.I32ShrU)
        .get(e.laneTemp(k + offset + 1));
      c.i32(Word.Bits - shift)
        .op(Op.I32Shl)
        .op(Op.I32Or);
    }
    setLane(e, lane);
  });
}

export function emitDuplicate(e: Emitter, pc: number, i: InstructionOf<"vdup">): void {
  const temp = e.laneTemp(0);
  if (i.bytes !== AccessBytes.Word) return emitUnsupported(e, pc);
  getLane(e, at(i.m, i.index));
  e.c.set(temp);
  for (const lane of vectorLanes(i.d, i.q)) {
    e.c.get(temp);
    setLane(e, lane);
  }
}

export function emitReverse64(e: Emitter, i: InstructionOf<"vrev64">): void {
  const temp = e.laneTemp(0);
  for (let r = 0; r < (i.q ? Lanes.PerDouble : 1); r++) {
    getLane(e, at(i.m + r, 0));
    e.c.set(temp);
    getLane(e, at(i.m + r, 1));
    setLane(e, at(i.d + r, 0));
    e.c.get(temp);
    setLane(e, at(i.d + r, 1));
  }
}

/** Narrowing reads all source lanes first because the destination may overlap them. */
export function emitNarrow(e: Emitter, i: InstructionOf<"vmovn">): void {
  const { c } = e;
  for (let k = 0; k < NarrowSources; k++) {
    getLane(e, at(i.m, k));
    c.set(e.laneTemp(k));
  }
  if (i.wide) {
    c.get(e.laneTemp(0));
    setLane(e, at(i.d, 0));
    c.get(e.laneTemp(Lanes.PerDouble));
    setLane(e, at(i.d, 1));
    return;
  }
  for (let k = 0; k < Lanes.PerDouble; k++) {
    c.get(e.laneTemp(Lanes.PerDouble * k))
      .i32(Word.Half)
      .op(Op.I32And);
    c.get(e.laneTemp(Lanes.PerDouble * k + 1))
      .i32(Word.HalfBits)
      .op(Op.I32Shl)
      .op(Op.I32Or);
    setLane(e, at(i.d, k));
  }
}

export function emitIntegerArithmetic(e: Emitter, i: InstructionOf<"viarith">): void {
  for (let k = 0; k < elements(i.q); k++) {
    getLane(e, at(i.n, k));
    getLane(e, at(i.m, k));
    e.c.op(i.sub ? Op.I32Sub : Op.I32Add);
    setLane(e, at(i.d, k));
  }
}

/** Multiplier that copies a low element into every element of a word. */
const REPLICATE = { 1: 0x01010101, 2: 0x00010001, 4: 1 } as const;
const ELEMENT_MASK = { 1: 0xff, 2: 0xffff, 4: -1 } as const;

export function emitDuplicateCore(e: Emitter, pc: number, i: InstructionOf<"vdupcore">): void {
  const [word] = e.t;
  reg(e, i.rt, pc);
  e.c.i32(ELEMENT_MASK[i.bytes]).op(Op.I32And).i32(REPLICATE[i.bytes]).op(Op.I32Mul).set(word);
  for (let k = 0; k < elements(i.q); k++) {
    e.c.get(word);
    setLane(e, at(i.d, k));
  }
}
