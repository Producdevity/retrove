import { Lanes, Single, Word } from "./emit-constants";
import { estimate } from "./emit-estimate";
import {
  defaultNaN,
  flushedLane,
  getLane,
  setLane,
  singleArithmetic,
  singleConvert,
} from "./emit-float";
import type { Emitter } from "./emitter";
import type { InstructionOf } from "./instruction";
import { Op } from "./wasm-opcodes";

const Step = {
  Two: 0x40000000,
  Three: 0x40400000,
  Half: 0x3f000000,
  OneAndHalf: 0x3fc00000,
  Results: 2,
} as const;
const Compare = {
  eq: Op.F32Eq,
  ge: Op.F32Ge,
  gt: Op.F32Gt,
  le: Op.F32Le,
  lt: Op.F32Lt,
} as const;

/** Element count of a D (2) or Q (4) register operation. */
export const elements = (q: boolean): number => (q ? Lanes.PerQuad : Lanes.PerDouble);
export const at = (register: number, k: number): number => Lanes.PerDouble * register + k;

/** Single min/max of two lanes into `target`, with flush-to-zero and default NaN. */
function minMax(e: Emitter, max: boolean, target: number, x: number, y: number): void {
  const { c } = e,
    [result] = e.t;
  flushedLane(e, x);
  c.op(Op.F32ReinterpretI32);
  flushedLane(e, y);
  c.op(Op.F32ReinterpretI32);
  c.op(max ? Op.F32Max : Op.F32Min, Op.I32ReinterpretF32).set(result);
  defaultNaN(e, result);
  setLane(e, target);
}

export function emitFloat(e: Emitter, i: InstructionOf<"vfloat">): void {
  for (let k = 0; k < elements(i.q); k++) {
    const d = at(i.d, k),
      n = at(i.n, k),
      m = at(i.m, k);
    if (i.op === "max" || i.op === "min") minMax(e, i.op === "max", d, n, m);
    else if (i.op === "mla" || i.op === "mls") {
      singleArithmetic(e, "mul", Lanes.Product, n, m);
      singleArithmetic(e, i.op === "mla" ? "add" : "sub", d, d, Lanes.Product);
    } else singleArithmetic(e, i.op, d, n, m);
  }
}

export function emitFloatSign(e: Emitter, i: InstructionOf<"vfneg">): void {
  for (let k = 0; k < elements(i.q); k++) {
    getLane(e, at(i.m, k));
    e.c.i32(i.abs ? Word.Magnitude : Word.Sign).op(i.abs ? Op.I32And : Op.I32Xor);
    setLane(e, at(i.d, k));
  }
}

/** The scalar is copied first because the destination may overlap it; the product is rounded before accumulating. */
export function emitScalarMultiply(e: Emitter, i: InstructionOf<"vmulscalar">): void {
  getLane(e, at(i.m, i.index));
  setLane(e, Lanes.Scalar);
  for (let k = 0; k < elements(i.q); k++) {
    const d = at(i.d, k);
    if (i.op === "mul") {
      singleArithmetic(e, "mul", d, at(i.n, k), Lanes.Scalar);
      continue;
    }
    singleArithmetic(e, "mul", Lanes.Product, at(i.n, k), Lanes.Scalar);
    singleArithmetic(e, i.op === "mla" ? "add" : "sub", d, d, Lanes.Product);
  }
}

export function emitFloatConvert(e: Emitter, i: InstructionOf<"vfcvt">): void {
  for (let k = 0; k < elements(i.q); k++)
    singleConvert(e, i.toInt, i.signed, true, at(i.d, k), at(i.m, k));
}

export function emitFloatCompare(e: Emitter, i: InstructionOf<"vfcmp">): void {
  const { c } = e;
  for (let k = 0; k < elements(i.q); k++) {
    flushedLane(e, at(i.n, k));
    c.op(Op.F32ReinterpretI32);
    if (i.zero) c.f32(0);
    else {
      flushedLane(e, at(i.m, k));
      c.op(Op.F32ReinterpretI32);
    }
    c.op(Compare[i.op]);
    c.set(e.laneTemp(k));
  }
  for (let k = 0; k < elements(i.q); k++) {
    c.i32(0).get(e.laneTemp(k)).op(Op.I32Sub);
    setLane(e, at(i.d, k));
  }
}

export function emitEstimate(e: Emitter, i: InstructionOf<"vestimate">): void {
  for (let k = 0; k < elements(i.q); k++) estimate(e, i.sqrt, at(i.d, k), at(i.m, k));
}

/** Pairwise results are computed into scratch lanes first because the destination may overlap a source. */
function copyPairwise(e: Emitter, d: number): void {
  for (let k = 0; k < Lanes.PerDouble; k++) {
    getLane(e, Lanes.Scalar + k);
    setLane(e, at(d, k));
  }
}

export function emitPairwiseMinMax(e: Emitter, i: InstructionOf<"vpminmax">): void {
  [i.n, i.m].forEach((register, k) =>
    minMax(e, i.max, Lanes.Scalar + k, at(register, 0), at(register, 1)),
  );
  copyPairwise(e, i.d);
}

export function emitPairwiseAdd(e: Emitter, i: InstructionOf<"vpadd">): void {
  [i.n, i.m].forEach((register, k) => {
    const x = at(register, 0),
      y = at(register, 1);
    if (i.float) singleArithmetic(e, "add", Lanes.Scalar + k, x, y);
    else {
      getLane(e, x);
      getLane(e, y);
      e.c.op(Op.I32Add);
      setLane(e, Lanes.Scalar + k);
    }
  });
  copyPairwise(e, i.d);
}

/** VRECPS: 2 - n*m; VRSQRTS: (3 - n*m) / 2, each step rounded (ARMv7). Infinity times zero gives 2 or 1.5. */
export function emitStep(e: Emitter, i: InstructionOf<"vstep">): void {
  const { c } = e;
  for (let k = 0; k < elements(i.q); k++) {
    const n = at(i.n, k),
      m = at(i.m, k),
      special = e.laneTemp(k);
    const zero = (s: number) => {
      flushedLane(e, s);
      c.i32(1).op(Op.I32Shl).op(Op.I32Eqz);
    };
    const infinite = (s: number) => {
      getLane(e, s);
      c.i32(1).op(Op.I32Shl).i32(Single.ShiftedInfinity).op(Op.I32Eq);
    };
    infinite(n);
    zero(m);
    c.op(Op.I32And);
    zero(n);
    infinite(m);
    c.op(Op.I32And).op(Op.I32Or).set(special);
    singleArithmetic(e, "mul", Lanes.Product, n, m);
    c.i32(i.sqrt ? Step.Three : Step.Two);
    setLane(e, Lanes.Scalar);
    singleArithmetic(e, "sub", Lanes.Product, Lanes.Scalar, Lanes.Product);
    if (i.sqrt) {
      c.i32(Step.Half);
      setLane(e, Lanes.Scalar);
      singleArithmetic(e, "mul", Lanes.Product, Lanes.Product, Lanes.Scalar);
    }
    c.i32(i.sqrt ? Step.OneAndHalf : Step.Two);
    getLane(e, Lanes.Product);
    c.get(special).op(Op.Select);
    setLane(e, Lanes.Scalar + Step.Results + k);
  }
  for (let k = 0; k < elements(i.q); k++) {
    getLane(e, Lanes.Scalar + Step.Results + k);
    setLane(e, at(i.d, k));
  }
}
