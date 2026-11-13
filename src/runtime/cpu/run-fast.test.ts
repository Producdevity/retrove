import { expect, test } from "vite-plus/test";
import { runFast, unsignedFloatToInteger } from "./run-fast";

test("RunFast flushes signed denormals and rounds each operation to float32", () => {
  expect(Object.is(runFast(-(2 ** -149)), -0)).toBe(true);
  expect(Object.is(runFast(-0), -0)).toBe(true);
  expect(runFast(2 ** -149)).toBe(0);
  expect(runFast(2 ** -126)).toBe(2 ** -126);
  expect(runFast(1 + 2 ** -24)).toBe(1);
  expect(runFast(1 + 2 ** -23)).toBe(1 + 2 ** -23);
  expect(runFast(Number.MAX_VALUE)).toBe(Infinity);
  expect(Number.isNaN(runFast(NaN))).toBe(true);
  const raw = new DataView(new ArrayBuffer(4));
  raw.setFloat32(0, runFast(-Infinity + Infinity), true);
  expect(raw.getUint32(0, true)).toBe(0x7fc00000);
});
test("ARM unsigned float conversion saturates before packed-byte narrowing", () => {
  expect(unsignedFloatToInteger(NaN)).toBe(0);
  expect(unsignedFloatToInteger(-Infinity)).toBe(0);
  expect(unsignedFloatToInteger(256.99)).toBe(256);
  expect(unsignedFloatToInteger(Infinity)).toBe(0xffffffff);
  expect(unsignedFloatToInteger(0x1_0000_0000)).toBe(0xffffffff);
});
