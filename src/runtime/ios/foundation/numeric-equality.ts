import type { NumericValue } from "./numbers";
export function numericEqual(left: NumericValue, right: NumericValue): boolean {
  if (typeof left === "bigint" && typeof right === "bigint") return left === right;
  const a = Number(left),
    b = Number(right);
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
