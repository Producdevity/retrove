import { expect, test } from "vite-plus/test";
import { geometry } from "./geometry";

const bits = (value: number) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
};
const setup = () => {
  const writes = new Map<number, number[]>();
  let next = 0x1000;
  const cg = geometry(
    {
      write: (address, bytes) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        writes.set(
          address,
          Array.from({ length: bytes.byteLength / 4 }, (_, index) =>
            view.getFloat32(index * 4, true),
          ),
        );
      },
    },
    { zero: (size) => (next += size) },
  );
  return { cg, writes };
};
const call = (
  fn: ((args: (index: number) => number) => number | bigint) | undefined,
  values: number[],
) => fn?.((index) => values[index] ?? 0);

test("rect getters normalize negative sizes", () => {
  const { cg } = setup();
  expect(call(cg.funcs["_CGRectGetWidth"], [10, 0, -4, 2].map(bits))).toBe(bits(4));
  expect(call(cg.funcs["_CGRectGetMidY"], [0, 10, 0, -4].map(bits))).toBe(bits(8));
});

test("integral rects expand outward and keep null rects null", () => {
  const { cg, writes } = setup();
  call(cg.funcs["_CGRectIntegral"], [0x2000, ...[0.5, 1.25, 2, 2].map(bits)]);
  expect(writes.get(0x2000)).toEqual([0, 1, 3, 3]);
  call(cg.funcs["_CGRectIntegral"], [0x3000, ...[Infinity, 0, 1, 1].map(bits)]);
  expect(writes.get(0x3000)).toEqual([Infinity, Infinity, 0, 0]);
});

test("constants are written once into zeroed guest memory", () => {
  const { cg, writes } = setup();
  const identity = cg.constants.get("_CGAffineTransformIdentity");
  expect(identity && writes.get(identity)).toEqual([1, 0, 0, 1, 0, 0]);
});

test("containment, insets and scaled transforms follow CoreGraphics", () => {
  const { cg, writes } = setup();
  expect(call(cg.funcs["_CGRectGetMinX"], [10, 0, -4, 2].map(bits))).toBe(bits(6));
  expect(call(cg.funcs["_CGRectGetMaxY"], [0, 10, 0, -4].map(bits))).toBe(bits(10));
  const rect = [0, 0, 10, 10];
  expect(call(cg.funcs["_CGRectContainsPoint"], [...rect, 0, 9.5].map(bits))).toBe(1);
  expect(call(cg.funcs["_CGRectContainsPoint"], [...rect, 10, 5].map(bits))).toBe(0);
  expect(call(cg.funcs["_CGRectContainsRect"], [...rect, 2, 2, 8, 8].map(bits))).toBe(1);
  call(cg.funcs["_CGRectInset"], [0x2000, ...[...rect, 2, 3].map(bits)]);
  expect(writes.get(0x2000)).toEqual([2, 3, 6, 4]);
  call(cg.funcs["_CGRectInset"], [0x3000, ...[...rect, 6, 0].map(bits)]);
  expect(writes.get(0x3000)).toEqual([Infinity, Infinity, 0, 0]);
  call(cg.funcs["_CGAffineTransformScale"], [0x4000, ...[1, 0, 0, 1, 5, 6, 2, 3].map(bits)]);
  expect(writes.get(0x4000)).toEqual([2, 0, 0, 3, 5, 6]);
});
