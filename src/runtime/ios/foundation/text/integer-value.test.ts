import { expect, test } from "vite-plus/test";
import { stringLongLong } from "./integer-value";
test("longLongValue preserves integer precision, decimal prefixes and saturated range", () => {
  expect(stringLongLong("  +9007199254740993 suffix")).toBe(9007199254740993n);
  expect(stringLongLong("-9223372036854775809")).toBe(-9223372036854775808n);
  expect(stringLongLong("9223372036854775808")).toBe(9223372036854775807n);
  expect(stringLongLong("0x10")).toBe(0n);
  expect(stringLongLong("-.5")).toBe(0n);
});
