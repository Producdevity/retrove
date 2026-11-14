import { expect, test } from "vite-plus/test";
import { bitmapLayout, packBitmap, unpackBitmap } from "./bitmap-format";

test("native CoreGraphics premultiplied layouts preserve padding and channel order", () => {
  const rgba = Uint8ClampedArray.of(
    255,
    0,
    0,
    255,
    0,
    255,
    0,
    128,
    0,
    0,
    255,
    255,
    255,
    255,
    255,
    64,
  );
  const native = [
    [
      1,
      [
        255, 0, 0, 255, 0, 128, 0, 128, 90, 90, 90, 90, 0, 0, 255, 255, 64, 64, 64, 64, 90, 90, 90,
        90,
      ],
    ],
    [
      2,
      [
        255, 255, 0, 0, 128, 0, 128, 0, 90, 90, 90, 90, 255, 0, 0, 255, 64, 64, 64, 64, 90, 90, 90,
        90,
      ],
    ],
    [
      0x2002,
      [
        0, 0, 255, 255, 0, 128, 0, 128, 90, 90, 90, 90, 255, 0, 0, 255, 64, 64, 64, 64, 90, 90, 90,
        90,
      ],
    ],
  ] as const;
  for (const [info, bytes] of native) {
    const layout = bitmapLayout(2, 2, 8, 12, 3, info);
    expect(layout).toBeDefined();
    if (!layout) throw new Error("Missing bitmap layout");
    const packed = new Uint8Array(24).fill(90);
    packBitmap(layout, rgba, packed);
    expect([...packed]).toEqual(bytes);
    expect(unpackBitmap(layout, packed)).toEqual(rgba);
  }
});
test("bitmap formats reject straight-alpha contexts and unbounded allocations", () => {
  for (const info of [0, 3, 4, 0x1001, 0x8001, 0x101])
    expect(bitmapLayout(2, 2, 8, 8, 3, info)).toBeUndefined();
  expect(bitmapLayout(2, 2, 16, 8, 3, 1)).toBeUndefined();
  expect(bitmapLayout(2, 2, 8, 7, 3, 1)).toBeUndefined();
  expect(bitmapLayout(0, 2, 8, 8, 3, 1)).toBeUndefined();
  expect(bitmapLayout(0x10000, 0x10000, 8, 0, 3, 1)).toBeUndefined();
  const alpha = bitmapLayout(2, 1, 8, 4, 0, 7);
  if (!alpha) throw new Error("Missing alpha-only layout");
  const packed = Uint8Array.of(128, 255, 90, 90),
    rgba = unpackBitmap(alpha, packed);
  expect([...rgba]).toEqual([255, 255, 255, 128, 255, 255, 255, 255]);
  packBitmap(alpha, rgba, packed);
  expect([...packed]).toEqual([128, 255, 90, 90]);
});

test("clearing preserves untouched native bytes, including unused alpha components", () => {
  const layout = bitmapLayout(2, 2, 8, 12, 3, 5);
  if (!layout) throw new Error("Missing opaque layout");
  const bytes = new Uint8Array(24).fill(90),
    before = unpackBitmap(layout, bytes),
    after = before.slice();
  after.fill(0, 8, 12);
  packBitmap(layout, after, bytes, before);
  expect([...bytes]).toEqual([
    90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 0, 0, 0, 0, 90, 90, 90, 90, 90, 90, 90, 90,
  ]);
});
