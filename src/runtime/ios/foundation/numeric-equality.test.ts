import { expect, test } from "vite-plus/test";
import { numericCompare, numericEqual } from "./numeric-equality";
test("NSNumber equality follows native floating promotion, booleans and NaN semantics", () => {
  expect(numericEqual(9007199254740993n, 9007199254740992)).toBe(true);
  expect(numericEqual(9007199254740993n, 9007199254740992n)).toBe(false);
  expect(numericEqual(NaN, NaN)).toBe(true);
  expect(numericEqual(NaN, 0)).toBe(false);
  expect(numericEqual(-0, 0)).toBe(true);
  expect(numericEqual(true, 1n)).toBe(true);
  expect(numericEqual(Infinity, Infinity)).toBe(true);
  expect(numericEqual(Infinity, -Infinity)).toBe(false);
});

test("numeric comparison is exact for 64-bit integers and promotes mixed operands", () => {
  expect(numericCompare(1, 2)).toBe(-1);
  expect(numericCompare(2.5, 2)).toBe(1);
  expect(numericCompare(9007199254740993n, 9007199254740992n)).toBe(1);
  expect(numericCompare(9007199254740993n, 9007199254740992)).toBe(0);
  expect(numericCompare(3n, 3)).toBe(0);
});
