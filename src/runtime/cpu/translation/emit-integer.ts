import { reg, setNZ } from "./emit-access";
import { Double, Word } from "./emit-constants";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { Register, type InstructionOf } from "./instruction";
import { Op } from "./wasm-opcodes";

const Extend = { ByteShift: 24, HalfShift: 16, Bytes16: 0x00ff00ff } as const;
const Reverse = {
  TopShift: 24,
  ByteShift: 8,
  SecondByte: 0xff00,
  OddBytes: 0xff00ff00,
  EvenBytes: 0x00ff00ff,
} as const;

export function emitMultiply(e: Emitter, pc: number, i: InstructionOf<"mul">): void {
  const { c } = e;
  if (i.rd === Register.PC) return emitUnsupported(e, pc);
  if (i.accumulate === "sub") reg(e, i.ra, pc);
  reg(e, i.rn, pc);
  reg(e, i.rm, pc);
  c.op(Op.I32Mul);
  if (i.accumulate === "add") {
    reg(e, i.ra, pc);
    c.op(Op.I32Add);
  }
  if (i.accumulate === "sub") c.op(Op.I32Sub);
  c.set(e.register(i.rd));
  if (i.s) setNZ(e, e.register(i.rd));
}

/** Division by zero gives 0 and INT_MIN / -1 gives INT_MIN, as on ARM; Wasm would trap on both. */
export function emitDivide(e: Emitter, pc: number, i: InstructionOf<"div">): void {
  const { c } = e,
    [n, m] = e.t;
  reg(e, i.rn, pc);
  c.set(n);
  reg(e, i.rm, pc);
  c.set(m);
  c.get(n);
  if (i.signed) {
    c.i32(1).get(m).get(m).op(Op.I32Eqz).get(n).i32(Word.Sign).op(Op.I32Eq);
    c.get(m).i32(-1).op(Op.I32Eq).op(Op.I32And).op(Op.I32Or).op(Op.Select).op(Op.I32DivS);
  } else c.i32(1).get(m).get(m).op(Op.I32Eqz).op(Op.Select).op(Op.I32DivU);
  c.i32(0).get(m).op(Op.Select).set(e.register(i.rd));
}

export function emitExtend(e: Emitter, pc: number, i: InstructionOf<"extend">): void {
  const { c } = e;
  if (
    (i.signed && i.form === "b16") ||
    (i.rn !== undefined && i.form === "b16") ||
    i.rd === Register.PC
  )
    return emitUnsupported(e, pc);
  reg(e, i.rm, pc);
  if (i.rotate) c.i32(i.rotate).op(Op.I32Rotr);
  if (i.form === "b16") c.i32(Extend.Bytes16).op(Op.I32And);
  else if (i.signed) {
    const shift = i.form === "b" ? Extend.ByteShift : Extend.HalfShift;
    c.i32(shift).op(Op.I32Shl).i32(shift).op(Op.I32ShrS);
  } else c.i32(i.form === "b" ? Word.Byte : Word.Half).op(Op.I32And);
  if (i.rn !== undefined) {
    reg(e, i.rn, pc);
    c.op(Op.I32Add);
  }
  c.set(e.register(i.rd));
}

export function emitMultiplyHalf(e: Emitter, pc: number, i: InstructionOf<"mulhalf">): void {
  const { c } = e;
  const pcs = [i.rd, i.rn, i.rm, i.ra];
  if (pcs.includes(Register.PC)) return emitUnsupported(e, pc);
  const half = (register: number, top: boolean) => {
    reg(e, register, pc);
    if (!top) c.i32(Word.HalfBits).op(Op.I32Shl);
    c.i32(Word.HalfBits).op(Op.I32ShrS);
  };
  half(i.rn, i.nTop);
  half(i.rm, i.mTop);
  c.op(Op.I32Mul);
  if (i.ra !== undefined) {
    reg(e, i.ra, pc);
    c.op(Op.I32Add);
  }
  c.set(e.register(i.rd));
}

export function emitMultiplyHigh(e: Emitter, pc: number, i: InstructionOf<"mulhigh">): void {
  const { c } = e;
  const pcs = [i.rd, i.rn, i.rm, i.ra];
  if (pcs.includes(Register.PC)) return emitUnsupported(e, pc);
  if (i.ra !== undefined) {
    reg(e, i.ra, pc);
    c.op(Op.I64ExtendI32U).i64(Double.HighShift).op(Op.I64Shl);
  }
  reg(e, i.rn, pc);
  c.op(Op.I64ExtendI32S);
  reg(e, i.rm, pc);
  c.op(Op.I64ExtendI32S).op(Op.I64Mul);
  if (i.ra !== undefined) c.op(i.subtract ? Op.I64Sub : Op.I64Add);
  if (i.round) c.i64(Double.Round).op(Op.I64Add);
  c.i64(Double.HighShift).op(Op.I64ShrU).op(Op.I32WrapI64).set(e.register(i.rd));
}

export function emitBitfield(e: Emitter, pc: number, i: InstructionOf<"bitfield">): void {
  const { c } = e;
  const mask = i.width === Word.Bits ? Word.All : ((((1 << i.width) >>> 0) - 1) << i.lsb) >>> 0;
  c.get(e.register(i.rd)).i32(~mask).op(Op.I32And);
  if (i.rn !== undefined) {
    reg(e, i.rn, pc);
    c.i32(i.lsb).op(Op.I32Shl).i32(mask).op(Op.I32And).op(Op.I32Or);
  }
  c.set(e.register(i.rd));
}

export function emitExtract(e: Emitter, pc: number, i: InstructionOf<"extract">): void {
  const { c } = e;
  reg(e, i.rn, pc);
  if (i.signed)
    c.i32(Word.Bits - i.lsb - i.width)
      .op(Op.I32Shl)
      .i32(Word.Bits - i.width)
      .op(Op.I32ShrS);
  else {
    c.i32(i.lsb).op(Op.I32ShrU);
    if (i.width < Word.Bits) c.i32(((1 << i.width) >>> 0) - 1).op(Op.I32And);
  }
  c.set(e.register(i.rd));
}

const HALF = { Low: 0x0000ffff, High: -0x10000, Bits: 16 } as const;
/** ASR #0 encodes a shift by 32; 31 leaves the same sign bits in the low half. */
const MAX_ARITHMETIC_SHIFT = 31;

export function emitPack(e: Emitter, pc: number, i: InstructionOf<"pack">): void {
  const { c } = e;
  reg(e, i.rn, pc);
  c.i32(i.top ? HALF.High : HALF.Low).op(Op.I32And);
  reg(e, i.rm, pc);
  if (i.top) {
    const amount = i.amount === 0 ? MAX_ARITHMETIC_SHIFT : Math.min(i.amount, MAX_ARITHMETIC_SHIFT);
    c.i32(amount).op(Op.I32ShrS).i32(HALF.Low).op(Op.I32And);
  } else c.i32(i.amount).op(Op.I32Shl).i32(HALF.High).op(Op.I32And);
  c.op(Op.I32Or).set(e.register(i.rd));
}

export function emitClz(e: Emitter, pc: number, i: InstructionOf<"clz">): void {
  reg(e, i.rm, pc);
  e.c.op(Op.I32Clz).set(e.register(i.rd));
}

export function emitReverse(e: Emitter, pc: number, i: InstructionOf<"reverse">): void {
  const { c } = e,
    [v, r] = e.t;
  if (i.rd === Register.PC || i.rm === Register.PC) return emitUnsupported(e, pc);
  c.get(e.register(i.rm)).set(v);
  if (i.form === "word") {
    c.get(v).i32(Reverse.TopShift).op(Op.I32Shl);
    c.get(v)
      .i32(Reverse.SecondByte)
      .op(Op.I32And)
      .i32(Reverse.ByteShift)
      .op(Op.I32Shl)
      .op(Op.I32Or);
    c.get(v)
      .i32(Reverse.ByteShift)
      .op(Op.I32ShrU)
      .i32(Reverse.SecondByte)
      .op(Op.I32And)
      .op(Op.I32Or);
    c.get(v).i32(Reverse.TopShift).op(Op.I32ShrU).op(Op.I32Or);
  } else if (i.form === "half") {
    c.get(v).i32(Reverse.ByteShift).op(Op.I32Shl).i32(Reverse.OddBytes).op(Op.I32And);
    c.get(v)
      .i32(Reverse.ByteShift)
      .op(Op.I32ShrU)
      .i32(Reverse.EvenBytes)
      .op(Op.I32And)
      .op(Op.I32Or);
  } else if (i.form === "signedHalf") {
    c.get(v).i32(Reverse.TopShift).op(Op.I32Shl).i32(Word.HalfBits).op(Op.I32ShrS);
    c.get(v).i32(Reverse.ByteShift).op(Op.I32ShrU).i32(Word.Byte).op(Op.I32And).op(Op.I32Or);
  } else {
    c.i32(0).set(r);
    for (let k = 0; k < Word.Bits; k++) {
      c.get(r).get(v).i32(k).op(Op.I32ShrU).i32(1).op(Op.I32And);
      c.i32(Word.SignShift - k)
        .op(Op.I32Shl)
        .op(Op.I32Or)
        .set(r);
    }
    c.get(r);
  }
  c.set(e.register(i.rd));
}

export function emitLongMultiply(e: Emitter, pc: number, i: InstructionOf<"mull">): void {
  const { c } = e,
    [product] = e.x;
  if (i.lo === Register.PC || i.hi === Register.PC || i.lo === i.hi) return emitUnsupported(e, pc);
  const extend = i.signed ? Op.I64ExtendI32S : Op.I64ExtendI32U;
  reg(e, i.rn, pc);
  c.op(extend);
  reg(e, i.rm, pc);
  c.op(extend).op(Op.I64Mul);
  if (i.accumulate) {
    c.get(e.register(i.hi)).op(Op.I64ExtendI32U).i64(Double.HighShift).op(Op.I64Shl);
    c.get(e.register(i.lo)).op(Op.I64ExtendI32U).op(Op.I64Or).op(Op.I64Add);
  }
  c.set(product).get(product).op(Op.I32WrapI64).set(e.register(i.lo));
  c.get(product).i64(Double.HighShift).op(Op.I64ShrU).op(Op.I32WrapI64).set(e.register(i.hi));
}
