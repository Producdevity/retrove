import { expect, test } from "vite-plus/test";
import { compileFloatKernel } from "./float-kernel";
import { runFast } from "../run-fast";
import type { FloatPlan } from "./float-plan";
const plan: FloatPlan = {
  memoryBytes: 64,
  operations: [
    { kind: "load", offset: 0 },
    { kind: "load", offset: 4 },
    { kind: "multiply", left: 0, right: 1 },
    { kind: "subtract", left: 2, right: 0 },
    { kind: "add", left: 3, right: 1 },
  ],
  outputs: [
    { offset: 16, value: 2 },
    { offset: 20, value: 3 },
    { offset: 24, value: 4 },
  ],
};
test("compiled float kernels preserve ARM RunFast rounding, signed zero and canonical NaN", () => {
  const kernel = compileFloatKernel(plan),
    view = new DataView(kernel.memory.buffer);
  const bits = [
    0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000, 0x3f800000, 0xbf800000, 0x7f7fffff,
    0x7f800000, 0xff800000, 0x7f800001, 0xffa00000,
  ];
  const expected = new DataView(new ArrayBuffer(12));
  for (const left of bits)
    for (const right of bits) {
      view.setUint32(0, left, true);
      view.setUint32(4, right, true);
      view.setUint32(28, 0x12345678, true);
      const x = runFast(view.getFloat32(0, true)),
        y = runFast(view.getFloat32(4, true));
      const product = runFast(x * y),
        difference = runFast(product - x),
        sum = runFast(difference + y);
      [product, difference, sum].forEach((n, i) => expected.setFloat32(i * 4, n, true));
      kernel.run();
      expect(new Uint8Array(kernel.memory.buffer, 16, 12)).toEqual(new Uint8Array(expected.buffer));
      expect(view.getUint32(28, true)).toBe(0x12345678);
    }
  expect(() => kernel.memory.grow(1)).toThrow(RangeError);
});
test("kernel plans reject forward references and out-of-bounds loads or stores before compilation", () => {
  const invalid: FloatPlan[] = [
    { ...plan, memoryBytes: 0 },
    { ...plan, memoryBytes: Infinity },
    { ...plan, operations: [{ kind: "load", offset: 61 }] },
    { ...plan, operations: [{ kind: "multiply", left: 0, right: 0 }] },
    { ...plan, outputs: [{ offset: 0, value: 99 }] },
    { ...plan, outputs: [{ offset: -4, value: 0 }] },
  ];
  for (const candidate of invalid) expect(() => compileFloatKernel(candidate)).toThrow(RangeError);
  const empty = compileFloatKernel({ memoryBytes: 4, operations: [], outputs: [] });
  expect(empty.run()).toBeUndefined();
});
