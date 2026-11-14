const DECIMAL_BASE = 10n;
const MANTISSA_BITS = 128n;
const MANTISSA_MAXIMUM = (BigInt(1) << MANTISSA_BITS) - BigInt(1);
const MINIMUM_EXPONENT = -128;
const MAXIMUM_EXPONENT = 127;
const MAXIMUM_INPUT = 1024;
export interface DecimalValue {
  coefficient: bigint;
  exponent: number;
}
export function decimal(coefficient: bigint, exponent: number): DecimalValue | undefined {
  if (!Number.isInteger(exponent) || exponent < MINIMUM_EXPONENT || exponent > MAXIMUM_EXPONENT)
    return undefined;
  if (!coefficient) return { coefficient, exponent: 0 };
  while (coefficient % DECIMAL_BASE === BigInt(0) && exponent < MAXIMUM_EXPONENT) {
    coefficient /= DECIMAL_BASE;
    exponent++;
  }
  if (coefficient > MANTISSA_MAXIMUM || coefficient < -MANTISSA_MAXIMUM)
    throw new RangeError("NSDecimalNumber mantissa exceeds supported precision.");
  return { coefficient, exponent };
}
export function parseDecimal(input: string): DecimalValue | undefined {
  if (input.length > MAXIMUM_INPUT)
    throw new RangeError("NSDecimalNumber input exceeds allocation limit.");
  const match =
    /^\s*(?<sign>[+-]?)(?:(?<whole>\d+)(?:\.(?<fraction>\d*))?|\.(?<leadingFraction>\d+))(?:[eE](?<exponent>[+-]?\d+))?/.exec(
      input,
    );
  const groups = match?.groups;
  if (!groups) return undefined;
  const fraction = groups.fraction ?? groups.leadingFraction ?? "";
  const coefficient = BigInt((groups.sign === "-" ? "-" : "") + (groups.whole ?? "0") + fraction);
  return decimal(coefficient, Number(groups.exponent ?? 0) - fraction.length);
}
export function decimalText(value: DecimalValue | undefined): string {
  if (!value) return "NaN";
  const sign = value.coefficient < BigInt(0) ? "-" : "",
    digits = String(value.coefficient < BigInt(0) ? -value.coefficient : value.coefficient);
  if (value.exponent >= 0) return sign + digits + "0".repeat(value.exponent);
  const position = digits.length + value.exponent;
  return (
    sign +
    (position > 0
      ? digits.slice(0, position) + "." + digits.slice(position)
      : "0." + "0".repeat(-position) + digits)
  );
}
export function decimalInteger(value: DecimalValue | undefined): bigint {
  if (!value) throw new Error("Cannot convert a NaN NSDecimalNumber to an integer.");
  return value.exponent >= 0
    ? value.coefficient * DECIMAL_BASE ** BigInt(value.exponent)
    : value.coefficient / DECIMAL_BASE ** BigInt(-value.exponent);
}
