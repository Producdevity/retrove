import { Single, Word } from "./emit-constants";
import { flushedLane, setLane } from "./emit-float";
import type { Emitter } from "./emitter";
import { Op, Saturating, Type } from "./wasm-opcodes";

const Estimate = {
  Half: 0.5,
  Exponent: 0xff,
  InfiniteExponent: 255,
  /** Biased exponents at or above this give reciprocals that flush to zero. */
  LargeExponent: 253,
  /** 256 * 512: the reciprocal numerator in units of the 8-bit estimate. */
  Numerator: 131072,
  Scale: 256,
  OddScale: 512,
  FractionShift: 15,
  SqrtFractionShift: 16,
  SqrtFraction: 0x7f,
  SqrtBase: 128,
  /** 3 * 127 - 1: twice the bias plus the odd/even adjustment of the halved exponent. */
  SqrtExponent: 380,
} as const;

/**
 * VRECPE.F32 / VRSQRTE.F32 with the ARMv7 estimate algorithm (FPSCR standard mode: flush-to-zero, default NaN).
 * The estimate depends only on the top 8 fraction bits (plus the exponent parity for square roots).
 */
export function estimate(e: Emitter, sqrt: boolean, d: number, m: number): void {
  const { c } = e,
    [, , , , x, exponent, result] = e.t;
  flushedLane(e, m);
  c.set(x);
  c.get(x)
    .i32(Single.ExponentShift)
    .op(Op.I32ShrU)
    .i32(Estimate.Exponent)
    .op(Op.I32And)
    .set(exponent);
  const sign = () => c.get(x).i32(Word.Sign).op(Op.I32And);
  // NaN -> default NaN.
  c.get(x).i32(1).op(Op.I32Shl).i32(Single.ShiftedInfinity).op(Op.I32GtU);
  c.open(Op.If, "nan", Type.I32).i32(Single.DefaultNaN);
  c.op(Op.Else);
  // ±0 -> ±inf.
  c.get(exponent).op(Op.I32Eqz).open(Op.If, "zero", Type.I32);
  sign();
  c.i32(Single.Exponent).op(Op.I32Or);
  c.op(Op.Else);
  if (sqrt) reciprocalSqrt(e, x, exponent);
  else reciprocal(e, x, exponent, sign);
  c.end().set(result);
  c.get(result);
  setLane(e, d);
}

/** ±inf and |x| >= 2^126 -> ±0 (flush to zero); otherwise INT(256 * 512 / (q + 0.5) + 0.5) for q = 256 + fraction[22:15]. */
function reciprocal(e: Emitter, x: number, exponent: number, sign: () => void): void {
  const { c } = e;
  c.get(exponent).i32(Estimate.LargeExponent).op(Op.I32GeU).open(Op.If, "large", Type.I32);
  sign();
  c.op(Op.Else);
  c.f64(Estimate.Numerator).get(x).i32(Estimate.FractionShift).op(Op.I32ShrU);
  c.i32(Estimate.Exponent).op(Op.I32And).i32(Estimate.Scale).op(Op.I32Add);
  c.op(Op.F64ConvertI32U).f64(Estimate.Half).op(Op.F64Add).op(Op.F64Div);
  c.f64(Estimate.Half).op(Op.F64Add).saturating(Saturating.I32TruncSatF64U);
  c.i32(Estimate.Scale).op(Op.I32Sub).i32(Estimate.FractionShift).op(Op.I32Shl);
  c.i32(Estimate.LargeExponent).get(exponent).op(Op.I32Sub).i32(Single.ExponentShift);
  c.op(Op.I32Shl).op(Op.I32Or);
  sign();
  c.op(Op.I32Or);
  c.end().end();
}

/**
 * Negative -> default NaN; +inf -> +0. Odd exponent: a in [0.25, 0.5), q = INT(a * 512); even: a in [0.5, 1),
 * q = INT(a * 256); both are 128 + fraction[22:16].
 */
function reciprocalSqrt(e: Emitter, x: number, exponent: number): void {
  const { c } = e;
  c.get(x).i32(0).op(Op.I32LtS).open(Op.If, "negative", Type.I32).i32(Single.DefaultNaN);
  c.op(Op.Else).get(exponent).i32(Estimate.InfiniteExponent).op(Op.I32Eq);
  c.open(Op.If, "infinite", Type.I32).i32(0);
  c.op(Op.Else);
  c.f64(1).get(x).i32(Estimate.SqrtFractionShift).op(Op.I32ShrU).i32(Estimate.SqrtFraction);
  c.op(Op.I32And).i32(Estimate.SqrtBase).op(Op.I32Add).op(Op.F64ConvertI32U);
  c.f64(Estimate.Half).op(Op.F64Add).get(exponent).i32(1).op(Op.I32And);
  c.open(Op.If, "odd", Type.F64).f64(Estimate.OddScale).op(Op.Else).f64(Estimate.Scale).end();
  c.op(Op.F64Div).op(Op.F64Sqrt).op(Op.F64Div).f64(Estimate.Scale).op(Op.F64Mul);
  c.f64(Estimate.Half).op(Op.F64Add).saturating(Saturating.I32TruncSatF64U);
  c.i32(Estimate.Scale).op(Op.I32Sub).i32(Estimate.FractionShift).op(Op.I32Shl);
  c.i32(Estimate.SqrtExponent).get(exponent).op(Op.I32Sub).i32(1).op(Op.I32ShrU);
  c.i32(Single.ExponentShift).op(Op.I32Shl).op(Op.I32Or);
  c.end().end().end();
}
