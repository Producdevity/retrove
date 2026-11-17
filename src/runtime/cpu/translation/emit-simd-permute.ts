import { Lanes, Word } from "./emit-constants";
import { getLane, setLane } from "./emit-float";
import { at, elements } from "./emit-simd-float";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { AccessBytes, type InstructionOf } from "./instruction";
import { Op, Type } from "./wasm-opcodes";

const ShiftByte = 24;
const NegativeLimit = -32;
const RightTemp = 2;

/** VZIP/VUZP: sources are read in full first because both registers are rewritten; each lane gathers its elements. */
export function emitZip(e: Emitter, i: InstructionOf<"vzip">): void {
  const { c } = e;
  const count = elements(i.q),
    bitsPer = Word.ByteBits * i.bytes,
    perLane = Word.Bytes / i.bytes,
    total = count * perLane;
  const a = Array.from({ length: count }, (_, k) => at(i.d, k)),
    b = Array.from({ length: count }, (_, k) => at(i.m, k));
  [...a, ...b].forEach((lane, k) => {
    getLane(e, lane);
    c.set(e.laneTemp(k));
  });
  const order: number[] = [];
  if (i.unzip) {
    for (let el = 0; el < Lanes.PerDouble * total; el += Lanes.PerDouble) order.push(el);
    for (let el = 1; el < Lanes.PerDouble * total; el += Lanes.PerDouble) order.push(el);
  } else for (let el = 0; el < total; el++) order.push(el, total + el);
  [...a, ...b].forEach((lane, k) => {
    for (let p = 0; p < perLane; p++) {
      const element = order[k * perLane + p] ?? 0;
      const shift = (element % perLane) * bitsPer;
      c.get(e.laneTemp(Math.floor(element / perLane)));
      if (shift) c.i32(shift).op(Op.I32ShrU);
      if (bitsPer < Word.Bits) c.i32((1 << bitsPer) - 1).op(Op.I32And);
      if (p)
        c.i32(p * bitsPer)
          .op(Op.I32Shl)
          .op(Op.I32Or);
    }
    setLane(e, lane);
  });
}

export function emitIntegerCompare(e: Emitter, i: InstructionOf<"vicompare">): void {
  const { c } = e;
  for (let k = 0; k < elements(i.q); k++) {
    c.i32(0);
    getLane(e, at(i.n, k));
    getLane(e, at(i.m, k));
    if (i.test) c.op(Op.I32And).i32(0).op(Op.I32Ne);
    else c.op(Op.I32Eq);
    c.op(Op.I32Sub);
    setLane(e, at(i.d, k));
  }
}

export function emitIntegerUnary(e: Emitter, i: InstructionOf<"viunary">): void {
  const { c } = e,
    temp = e.laneTemp(0);
  for (let k = 0; k < elements(i.q); k++) {
    if (i.abs) {
      getLane(e, at(i.m, k));
      c.set(temp);
      c.i32(0).get(temp).op(Op.I32Sub).get(temp).get(temp).i32(0).op(Op.I32LtS).op(Op.Select);
    } else {
      c.i32(0);
      getLane(e, at(i.m, k));
      c.op(Op.I32Sub);
    }
    setLane(e, at(i.d, k));
  }
}

/** The shift is the signed low byte of each n element; magnitudes of 32 or more clear (or sign-fill) the element. */
export function emitShiftRegister(e: Emitter, i: InstructionOf<"vshlreg">): void {
  const { c } = e,
    value = e.laneTemp(0),
    shift = e.laneTemp(1),
    right = e.laneTemp(RightTemp);
  for (let k = 0; k < elements(i.q); k++) {
    getLane(e, at(i.m, k));
    c.set(value);
    getLane(e, at(i.n, k));
    c.i32(ShiftByte).op(Op.I32Shl).i32(ShiftByte).op(Op.I32ShrS).set(shift);
    c.get(shift).i32(0).op(Op.I32GeS).open(Op.If, "left", Type.I32);
    c.get(value)
      .get(shift)
      .op(Op.I32Shl)
      .i32(0)
      .get(shift)
      .i32(Word.Bits)
      .op(Op.I32LtS)
      .op(Op.Select);
    c.op(Op.Else);
    if (i.unsigned) {
      c.get(value).i32(0).get(shift).op(Op.I32Sub).op(Op.I32ShrU).i32(0);
      c.get(shift).i32(NegativeLimit).op(Op.I32GtS).op(Op.Select);
    } else {
      c.get(value).i32(0).get(shift).op(Op.I32Sub).tee(right).i32(Word.SignShift);
      c.get(right).i32(Word.SignShift).op(Op.I32LtU).op(Op.Select).op(Op.I32ShrS);
    }
    c.end();
    setLane(e, at(i.d, k));
  }
}

export function emitTranspose(e: Emitter, pc: number, i: InstructionOf<"vtrn">): void {
  const temp = e.laneTemp(0);
  if (i.bytes !== AccessBytes.Word) return emitUnsupported(e, pc);
  for (let k = 0; k < (i.q ? Lanes.PerDouble : 1); k++) {
    const a = at(i.d + k, 1),
      b = at(i.m + k, 0);
    getLane(e, a);
    e.c.set(temp);
    getLane(e, b);
    setLane(e, a);
    e.c.get(temp);
    setLane(e, b);
  }
}
