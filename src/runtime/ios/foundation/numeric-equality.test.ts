import { expect, test } from "vite-plus/test";
import { numericEqual } from "./numeric-equality";
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
