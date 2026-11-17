import type { NumericValue } from "./numbers";
export function numericEqual(left: NumericValue, right: NumericValue): boolean {
  if (typeof left === "bigint" && typeof right === "bigint") return left === right;
  const a = Number(left),
    b = Number(right);
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
const Ordered = { Ascending: -1, Same: 0, Descending: 1 } as const;
// Mixed operands promote to double like NSNumber, so only two 64-bit integers compare exactly.
export function numericCompare(left: NumericValue, right: NumericValue): number {
  if (numericEqual(left, right)) return Ordered.Same;
  if (typeof left === "bigint" && typeof right === "bigint")
    return left < right ? Ordered.Ascending : Ordered.Descending;
  return Number(left) < Number(right) || Number.isNaN(Number(left))
    ? Ordered.Ascending
    : Ordered.Descending;
}
