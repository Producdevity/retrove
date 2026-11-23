import type { GuestArguments } from "../ios/objc/host";
import { doubleWide, f32, floatWord } from "../ios/libc/pure-math";
import { write32, type GuestMemory } from "../memory/guest-memory";

const HIGH_WORD = 32n;
const LOW_WORD = 0xffff_ffffn;
const DOUBLE_BYTES = 8;
const WORD_BYTES = 4;
const EXPONENT_SHIFT = 52n;
const EXPONENT_MASK = 0x7ffn;
const SIGN_AND_MANTISSA = 0x800f_ffff_ffff_ffffn;
/** frexp's result exponent field: the mantissa is scaled into [0.5, 1). */
const HALF_EXPONENT = 1022;
const HALF_EXPONENT_FIELD = 1022n;
/** Scales subnormals into the normal range before reading their exponent. */
const SUBNORMAL_SCALE = 54;
const MAX_EXPONENT = 1023;
const MIN_EXPONENT = -1022;
/** ldexp steps through intermediate scales so 2**n never overflows or underflows on its own. */
const SCALE_DOWN = -969;
const EXPONENT_CLAMP = 2200;
const RADIX = 2;
const Arg = { First: 0, Second: 1, Third: 2 } as const;
/** A double argument takes two words; the next argument follows them. */
const AFTER_DOUBLE = 2;

type MathImport = (a: GuestArguments) => number | bigint;
const bits = new DataView(new ArrayBuffer(DOUBLE_BYTES));
const u64 = (a: GuestArguments, i: number): bigint =>
  BigInt(a(i) >>> 0) | (BigInt(a(i + 1) >>> 0) << HIGH_WORD);
function f64(a: GuestArguments, i: number): number {
  bits.setBigUint64(0, u64(a, i), true);
  return bits.getFloat64(0, true);
}

/** libm functions that write results through guest pointers. */
export function memoryMathImports(cpu: GuestMemory): Record<string, MathImport> {
  function writeDouble(at: number, n: number): void {
    const w = doubleWide(n);
    write32(cpu, at, Number(w & LOW_WORD));
    write32(cpu, at + WORD_BYTES, Number(w >> HIGH_WORD));
  }
  const funcs: Record<string, MathImport> = {};
  const modf = [
    ["_modf", f64, doubleWide, writeDouble, AFTER_DOUBLE],
    ["_modff", f32, floatWord, (p: number, n: number) => write32(cpu, p, floatWord(n)), 1],
  ] as const;
  for (const [name, readValue, encode, sink, at] of modf) {
    funcs[name] = (a) => {
      const n = readValue(a, 0),
        whole = Math.trunc(n);
      sink(a(at), whole);
      let fraction = n - whole;
      if (n === whole) fraction = n < 0 || Object.is(n, -0) ? -0 : 0;
      return encode(fraction);
    };
  }
  funcs["_frexp"] = (a) => {
    let value = f64(a, 0),
      exp = 0;
    if (Number.isFinite(value) && value !== 0) {
      let encoded = doubleWide(value),
        raw = Number((encoded >> EXPONENT_SHIFT) & EXPONENT_MASK);
      if (!raw) {
        encoded = doubleWide(value * RADIX ** SUBNORMAL_SCALE);
        raw = Number((encoded >> EXPONENT_SHIFT) & EXPONENT_MASK);
        exp -= SUBNORMAL_SCALE;
      }
      exp += raw - HALF_EXPONENT;
      bits.setBigUint64(
        0,
        (encoded & SIGN_AND_MANTISSA) | (HALF_EXPONENT_FIELD << EXPONENT_SHIFT),
        true,
      );
      value = bits.getFloat64(0, true);
    }
    write32(cpu, a(AFTER_DOUBLE), exp);
    return doubleWide(value);
  };
  funcs["_ldexp"] = (a) => ldexp(f64(a, 0), a(AFTER_DOUBLE) | 0);
  funcs["___sincos_stret"] = (a) => {
    const n = f64(a, Arg.Second);
    writeDouble(a(Arg.First), Math.sin(n));
    writeDouble(a(Arg.First) + DOUBLE_BYTES, Math.cos(n));
    return a(Arg.First);
  };
  funcs["___sincosf_stret"] = (a) => {
    const n = f32(a, Arg.Second);
    write32(cpu, a(Arg.First), floatWord(Math.sin(n)));
    write32(cpu, a(Arg.First) + WORD_BYTES, floatWord(Math.cos(n)));
    return a(Arg.First);
  };
  return funcs;
}

function ldexp(value: number, exponent: number): bigint {
  let x = value,
    n = exponent;
  if (!Number.isFinite(x) || x === 0) return doubleWide(x);
  n = Math.max(-EXPONENT_CLAMP, Math.min(EXPONENT_CLAMP, n));
  if (n > MAX_EXPONENT) {
    x *= RADIX ** MAX_EXPONENT;
    n -= MAX_EXPONENT;
    if (n > MAX_EXPONENT) {
      x *= RADIX ** MAX_EXPONENT;
      n -= MAX_EXPONENT;
    }
  }
  if (n < MIN_EXPONENT) {
    x *= RADIX ** SCALE_DOWN;
    n -= SCALE_DOWN;
    if (n < MIN_EXPONENT) {
      x *= RADIX ** SCALE_DOWN;
      n -= SCALE_DOWN;
    }
  }
  return doubleWide(x * RADIX ** n);
}
