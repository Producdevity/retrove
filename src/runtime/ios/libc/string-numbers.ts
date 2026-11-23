import { readCStringBytes, write32, type GuestMemory } from "../../memory/guest-memory";
import { Errno } from "./bsd-errno";
import { asciiLower } from "./rune-locale";

const ZERO = 0n;
const ONE = 1n;
const BINARY = 2;
const HEX_DIGITS_PER_BYTE = 4;
const SIGNIFICANT_HEX_DIGITS = 16;
const HEX_PREFIX_LENGTH = 2;
const MAX_EXPONENT = 1023;
const MIN_EXPONENT = -1075;
const MIN_UNIT = -1074;
const MIN_NORMAL_EXPONENT = -1022;
const MANTISSA_BITS = 52;
const Char = {
  Tab: 9,
  CarriageReturn: 13,
  Space: 32,
  Plus: 43,
  Minus: 45,
  Zero: 48,
  Nine: 57,
  LowerA: 97,
  LowerX: 120,
  LowerZ: 122,
  LetterBase: 87,
} as const;
const Radix = { Min: 2, Octal: 8, Decimal: 10, Hex: 16, Max: 36 } as const;
const MAX_HEX_DIGIT = 15;
const REAL_TOKEN =
  /^[\t-\r ]*([+-]?)(inf(?:inity)?|nan(?:\([a-z0-9_]*\))?|0x(?:[a-f\d]+(?:\.[a-f\d]*)?|\.[a-f\d]+)(?:p[+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i;
const NONZERO_DIGIT = /[1-9a-f]/;

// Round the significand to binary64 before applying the power of two, including
// subnormals. Sixteen hex digits cover the mantissa plus all rounding bits.
function hexFloat(source: string): number {
  const [mantissa = "", exponent] = source.slice(HEX_PREFIX_LENGTH).toLowerCase().split("p");
  const point = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "").replace(/^0+/, "");
  if (!digits.length) return 0;
  const significant = digits.slice(0, SIGNIFICANT_HEX_DIGITS),
    sticky = NONZERO_DIGIT.test(digits.slice(SIGNIFICANT_HEX_DIGITS));
  const integer = BigInt("0x" + significant);
  const fraction = point < 0 ? 0 : mantissa.length - point - 1;
  const scale =
    Number(exponent || 0) + HEX_DIGITS_PER_BYTE * (digits.length - significant.length - fraction);
  const e = integer.toString(BINARY).length - 1 + scale;
  if (e > MAX_EXPONENT) return Infinity;
  if (e < MIN_EXPONENT) return 0;
  const unit = Math.max(MIN_UNIT, e - MANTISSA_BITS),
    shift = BigInt(unit - scale);
  let rounded = integer >> shift;
  if (shift > ZERO) {
    const remainder = integer - (rounded << shift),
      half = ONE << (shift - ONE);
    if (remainder > half || (remainder === half && (sticky || rounded & ONE))) rounded++;
  }
  return Number(rounded) * BINARY ** unit;
}

function digit(code: number): number {
  if (code >= Char.Zero && code <= Char.Nine) return code - Char.Zero;
  const lower = asciiLower(code);
  return lower >= Char.LowerA && lower <= Char.LowerZ ? lower - Char.LetterBase : -1;
}

type Units = (address: number, width: number) => Generator<number, void>;

class Reader {
  at: number;
  c: number;
  private readonly stream: Generator<number, void>;
  constructor(
    units: Units,
    start: number,
    private readonly width: number,
  ) {
    this.stream = units(start, width);
    this.at = start;
    this.c = this.stream.next().value ?? 0;
  }
  advance(): void {
    this.at += this.width;
    this.c = this.stream.next().value ?? 0;
  }
}

interface Prefix {
  base: number;
  stop: number;
  valid: boolean;
}

// A prefix counts only when at least one valid hex digit follows it.
function readPrefix(reader: Reader, base: number, start: number): Prefix {
  if ((base === 0 || base === Radix.Hex) && reader.c === Char.Zero) {
    reader.advance();
    const stop = reader.at;
    if (asciiLower(reader.c) === Char.LowerX) {
      reader.advance();
      const following = digit(reader.c);
      const valid = following >= 0 && following <= MAX_HEX_DIGIT;
      return { base: Radix.Hex, stop, valid };
    }
    return { base: base || Radix.Octal, stop, valid: true };
  }
  return { base, stop: start, valid: true };
}

export class StringNumbers {
  private readonly bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  private readonly latin = new TextDecoder("latin1");

  constructor(
    private readonly cpu: GuestMemory,
    private readonly errno: number,
    private readonly units: Units,
  ) {}

  unsigned(start: number, end: number, baseArgument: number, width: number, bits: number): bigint {
    const base = baseArgument | 0;
    if (base && (base < Radix.Min || base > Radix.Max)) {
      write32(this.cpu, this.errno, Errno.Invalid);
      if (end) write32(this.cpu, end, start);
      return ZERO;
    }
    const reader = new Reader(this.units, start, width);
    while (reader.c === Char.Space || (reader.c >= Char.Tab && reader.c <= Char.CarriageReturn))
      reader.advance();
    const negative = reader.c === Char.Minus;
    if (negative || reader.c === Char.Plus) reader.advance();
    const prefix = readPrefix(reader, base, start);
    if (!prefix.valid) {
      if (end) write32(this.cpu, end, prefix.stop);
      return ZERO;
    }
    return this.digits(reader, prefix, end, bits, negative);
  }

  private digits(reader: Reader, prefix: Prefix, end: number, bits: number, negative: boolean) {
    const base = prefix.base || Radix.Decimal;
    const radix = BigInt(base),
      limit = (ONE << BigInt(bits)) - ONE;
    let value = ZERO,
      overflow = false,
      stop = prefix.stop;
    for (;;) {
      const d = digit(reader.c);
      if (d < 0 || d >= base) break;
      if (!overflow) {
        value = value * radix + BigInt(d);
        overflow = value > limit;
      }
      reader.advance();
      stop = reader.at;
    }
    if (end) write32(this.cpu, end, stop);
    if (overflow) {
      write32(this.cpu, this.errno, Errno.OutOfRange);
      return limit;
    }
    return negative ? BigInt.asUintN(bits, -value) : value;
  }

  real(source: number, end: number): bigint {
    const text = this.latin.decode(readCStringBytes(this.cpu, source));
    const match = REAL_TOKEN.exec(text);
    let value = 0;
    if (match) {
      const [whole = "", sign, name = ""] = match;
      const token = name.toLowerCase(),
        hex = token.startsWith("0x");
      if (token.startsWith("inf")) value = Infinity;
      else if (token.startsWith("nan")) value = NaN;
      else {
        value = hex ? hexFloat(token) : Number(token);
        const significand = token.split(hex ? "p" : "e")[0] ?? "";
        if (
          !Number.isFinite(value) ||
          (value < BINARY ** MIN_NORMAL_EXPONENT && NONZERO_DIGIT.test(significand))
        )
          write32(this.cpu, this.errno, Errno.OutOfRange);
      }
      if (sign === "-") value = -value;
      if (end) write32(this.cpu, end, source + whole.length);
    } else if (end) write32(this.cpu, end, source);
    this.bits.setFloat64(0, value, true);
    return this.bits.getBigUint64(0, true);
  }
}
