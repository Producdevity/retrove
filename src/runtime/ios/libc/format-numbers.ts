const ZERO = 0n;
const ONE = 1n;
const HEX_RADIX = 16;
const OCTAL_RADIX = 8;
const DECIMAL_RADIX = 10;
const Width = { Byte: 8, Half: 16, Word: 32, Long: 64 } as const;
const DEFAULT_PRECISION = 6;
const EXPONENT_DIGITS = 2;
const SHORTEST_EXPONENT = -4;
const MANTISSA_BITS = 52n;
const MANTISSA_MASK = 0xf_ffff_ffff_ffffn;
const MAGNITUDE_MASK = 0x7fff_ffff_ffff_ffffn;
const EXPONENT_BIAS = 1023;
const SUBNORMAL_EXPONENT = -1022;
const HEX_MANTISSA_DIGITS = 13;
const BITS_PER_HEX_DIGIT = 4;

export interface Piece {
  s: string;
  prefix: string;
  pad: string;
}

function integerWidth(length: string | undefined, long: boolean): number {
  if (long) return Width.Long;
  if (length === "hh") return Width.Byte;
  return length === "h" ? Width.Half : Width.Word;
}

export function formatInteger(
  value: bigint,
  kind: string,
  flags: string,
  precision: number | undefined,
  length: string | undefined,
  long: boolean,
): Piece {
  const signed = kind === "d" || kind === "i";
  const radix = "xXp".includes(kind) ? HEX_RADIX : kind === "o" ? OCTAL_RADIX : DECIMAL_RADIX;
  const size = integerWidth(length, long);
  let n = signed ? BigInt.asIntN(size, value) : BigInt.asUintN(size, value);
  let prefix = "";
  if (n < ZERO) {
    n = -n;
    prefix = "-";
  } else if (signed) prefix = flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
  let s = n === ZERO && precision === 0 ? "" : n.toString(radix);
  let pad = " ";
  if (precision !== undefined) s = s.padStart(precision, "0");
  else if (flags.includes("0")) pad = "0";
  if (kind === "p" || (flags.includes("#") && n !== ZERO && radix === HEX_RADIX)) prefix = "0x";
  if (flags.includes("#") && radix === OCTAL_RADIX && !s.startsWith("0")) prefix = "0";
  if (kind === "X") {
    s = s.toUpperCase();
    prefix = prefix.toUpperCase();
  }
  return { s, prefix, pad };
}

function hexFloat(raw: bigint, precision: number | undefined, alternate: boolean) {
  const magnitude = raw & MAGNITUDE_MASK;
  const biased = Number(magnitude >> MANTISSA_BITS),
    exponent = biased ? biased - EXPONENT_BIAS : magnitude ? SUBNORMAL_EXPONENT : 0;
  const digits = precision ?? DEFAULT_PRECISION;
  let fraction = (magnitude & MANTISSA_MASK).toString(HEX_RADIX).padStart(HEX_MANTISSA_DIGITS, "0");
  let lead = biased ? 1 : 0;
  if (precision !== undefined && digits < HEX_MANTISSA_DIGITS) {
    const significand = (BigInt(lead) << MANTISSA_BITS) | (magnitude & MANTISSA_MASK);
    const shift = BigInt((HEX_MANTISSA_DIGITS - digits) * BITS_PER_HEX_DIGIT),
      half = ONE << (shift - ONE);
    const keep = significand >> shift,
      remainder = significand - (keep << shift);
    const rounded = keep + (remainder > half || (remainder === half && keep & ONE) ? ONE : ZERO);
    const text = rounded.toString(HEX_RADIX).padStart(digits + 1, "0");
    lead = parseInt(text.charAt(0), HEX_RADIX);
    fraction = text.slice(1);
  } else
    fraction = precision === undefined ? fraction.replace(/0+$/, "") : fraction.padEnd(digits, "0");
  return (
    lead +
    (fraction || alternate ? "." + fraction : "") +
    "p" +
    (exponent < 0 ? "" : "+") +
    exponent
  );
}

function decimalFloat(n: number, code: string, flags: string, precision: number | undefined) {
  const digits = precision ?? DEFAULT_PRECISION;
  let style = code,
    places = digits;
  if (code === "g") {
    const significant = Math.max(1, digits);
    const exponent = Number(n.toExponential(significant - 1).split("e")[1]);
    style = exponent < SHORTEST_EXPONENT || exponent >= significant ? "e" : "f";
    places = style === "e" ? significant - 1 : Math.max(0, significant - exponent - 1);
  }
  const text = style === "f" ? n.toFixed(places) : n.toExponential(places);
  const [first = "", power] = text.split("e");
  let mantissa = first;
  if (code === "g" && !flags.includes("#") && mantissa.includes("."))
    mantissa = mantissa.replace(/0+$/, "").replace(/\.$/, "");
  if (flags.includes("#") && !mantissa.includes(".")) mantissa += ".";
  return (
    mantissa +
    (power === undefined
      ? ""
      : "e" + power.charAt(0) + power.slice(1).padStart(EXPONENT_DIGITS, "0"))
  );
}

const scratch = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));

export function formatFloat(
  raw: bigint,
  kind: string,
  flags: string,
  precision: number | undefined,
): Piece {
  scratch.setBigUint64(0, raw, true);
  let n = scratch.getFloat64(0, true);
  let prefix =
    n < 0 || Object.is(n, -0) ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
  n = Math.abs(n);
  const code = kind.toLowerCase();
  let s = "",
    pad = " ";
  if (Number.isNaN(n)) s = "nan";
  else if (n === Infinity) s = "inf";
  else {
    if (flags.includes("0")) pad = "0";
    if (code === "a") {
      s = hexFloat(raw, precision, flags.includes("#"));
      prefix += "0x";
    } else s = decimalFloat(n, code, flags, precision);
  }
  if (kind === kind.toUpperCase()) {
    s = s.toUpperCase();
    prefix = prefix.toUpperCase();
  }
  return { s, prefix, pad };
}
