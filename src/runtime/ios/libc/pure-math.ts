/** Reads argument word n of a call (registers, then the stack). */
export type Argument = (n: number) => number;
/** A libSystem or compiler-rt function of its argument words alone: no memory, no thread state. */
export type PureImport = (a: Argument) => number | bigint;

const HIGH_WORD = 32n;
const FLOAT_MANTISSA_BITS = 24;
const WIDE_BITS = 64;
const ZERO = 0n;
const ONE = 1n;
const SIGNED_64_MAX = (ONE << BigInt(WIDE_BITS - 1)) - ONE;
const SIGNED_64_MIN = -(ONE << BigInt(WIDE_BITS - 1));
const UNSIGNED_64_MAX = (ONE << BigInt(WIDE_BITS)) - ONE;
const HALF = 0.5;
const RADIX = 2;
const DOUBLE_BYTES = 8;
/** A 64-bit argument takes two words: the second one starts at word 2. */
const SECOND_WIDE = 2;

const bits = new DataView(new ArrayBuffer(DOUBLE_BYTES));
const u64 = (a: Argument, i: number): bigint =>
  BigInt(a(i) >>> 0) | (BigInt(a(i + 1) >>> 0) << HIGH_WORD);
const i64 = (a: Argument, i: number): bigint => BigInt.asIntN(WIDE_BITS, u64(a, i));
function f32(a: Argument, i: number): number {
  bits.setUint32(0, a(i), true);
  return bits.getFloat32(0, true);
}
function f64(a: Argument, i: number): number {
  bits.setBigUint64(0, u64(a, i), true);
  return bits.getFloat64(0, true);
}
/** The single-precision bit pattern of n. */
export function floatWord(n: number): number {
  bits.setFloat32(0, n, true);
  return bits.getUint32(0, true);
}
/** The double-precision bit pattern of n, returned in r0:r1. */
export function doubleWide(n: number): bigint {
  bits.setFloat64(0, n, true);
  return bits.getBigUint64(0, true);
}
/** Rounds a 64-bit integer to single precision with ties to even, as compiler-rt does. */
function intFloat(value: bigint): number {
  const negative = value < ZERO;
  const magnitude = negative ? -value : value;
  const shift = magnitude.toString(RADIX).length - FLOAT_MANTISSA_BITS;
  if (shift <= 0) return floatWord(Number(value));
  const n = BigInt(shift),
    half = ONE << (n - ONE);
  let rounded = magnitude >> n;
  const remainder = magnitude - (rounded << n);
  if (remainder > half || (remainder === half && rounded & ONE)) rounded++;
  return floatWord((negative ? -1 : 1) * Number(rounded) * RADIX ** shift);
}
function exactDivide(a: number, b: number): number {
  if (!b) throw new Error("Guest integer division by zero");
  return Math.trunc(a / b);
}
function roundEven(n: number): number {
  const i = Math.trunc(n),
    fraction = Math.abs(n - i);
  return fraction < HALF || (fraction === HALF && i % RADIX === 0) ? i : i + Math.sign(n);
}
/** Nonrepresentable integer conversions saturate at the compiler-rt boundary. */
function saturate(n: number, signed: boolean): bigint {
  const high = signed ? SIGNED_64_MAX : UNSIGNED_64_MAX,
    low = signed ? SIGNED_64_MIN : ZERO;
  let value: bigint;
  if (Number.isNaN(n)) value = ZERO;
  else if (n === Infinity) value = high;
  else if (n === -Infinity) value = low;
  else {
    const i = BigInt(Math.trunc(n));
    value = i < low ? low : i > high ? high : i;
  }
  return BigInt.asUintN(WIDE_BITS, value);
}

const UNARY: readonly (readonly [string, (x: number) => number])[] = [
  ["acos", Math.acos],
  ["asin", Math.asin],
  ["atan", Math.atan],
  ["ceil", Math.ceil],
  ["cos", Math.cos],
  ["exp", Math.exp],
  ["floor", Math.floor],
  ["log", Math.log],
  ["log10", Math.log10],
  ["sin", Math.sin],
  ["tan", Math.tan],
  ["sqrt", Math.sqrt],
  ["fabs", Math.abs],
];
const DOUBLE_ONLY: readonly (readonly [string, (x: number) => number])[] = [
  ["cosh", Math.cosh],
  ["sinh", Math.sinh],
  ["tanh", Math.tanh],
  ["exp2", (x) => RADIX ** x],
];
const BINARY: readonly (readonly [string, (x: number, y: number) => number])[] = [
  ["atan2", Math.atan2],
  ["pow", Math.pow],
  ["fmod", (x, y) => x % y],
];

/** libm and compiler-rt imports that any thread can run, keyed by symbol. */
export function pureMathImports(): Record<string, PureImport> {
  const funcs: Record<string, PureImport> = {
    ___divdi3: (a) => BigInt.asUintN(WIDE_BITS, i64(a, 0) / i64(a, SECOND_WIDE)),
    ___udivdi3: (a) => u64(a, 0) / u64(a, SECOND_WIDE),
    ___umoddi3: (a) => u64(a, 0) % u64(a, SECOND_WIDE),
    ___divsi3: (a) => exactDivide(a(0) | 0, a(1) | 0) >>> 0,
    ___udivsi3: (a) => exactDivide(a(0) >>> 0, a(1) >>> 0) >>> 0,
    ___modsi3: (a) => {
      const x = a(0) | 0,
        y = a(1) | 0;
      return (x - y * exactDivide(x, y)) >>> 0;
    },
    ___umodsi3: (a) => {
      const x = a(0) >>> 0,
        y = a(1) >>> 0;
      return (x - y * exactDivide(x, y)) >>> 0;
    },
    ___floatdidf: (a) => doubleWide(Number(i64(a, 0))),
    ___floatundidf: (a) => doubleWide(Number(u64(a, 0))),
    ___floatdisf: (a) => intFloat(i64(a, 0)),
    ___floatundisf: (a) => intFloat(u64(a, 0)),
    ___fixdfdi: (a) => saturate(f64(a, 0), true),
    ___fixsfdi: (a) => saturate(f32(a, 0), true),
    ___fixunsdfdi: (a) => saturate(f64(a, 0), false),
    ___fixunssfdi: (a) => saturate(f32(a, 0), false),
    _rintf: (a) => floatWord(roundEven(f32(a, 0))),
    _lrintf: (a) => roundEven(f32(a, 0)) | 0,
    _roundf: (a) => {
      const x = f32(a, 0);
      return floatWord(x < 0 ? -Math.round(-x) : Math.round(x));
    },
  };
  for (const [name, op] of UNARY) {
    funcs["_" + name] = (a) => doubleWide(op(f64(a, 0)));
    funcs["_" + name + "f"] = (a) => floatWord(op(f32(a, 0)));
  }
  for (const [name, op] of DOUBLE_ONLY) funcs["_" + name] = (a) => doubleWide(op(f64(a, 0)));
  for (const [name, op] of BINARY) {
    funcs["_" + name] = (a) => doubleWide(op(f64(a, 0), f64(a, SECOND_WIDE)));
    funcs["_" + name + "f"] = (a) => floatWord(op(f32(a, 0), f32(a, 1)));
  }
  return funcs;
}
