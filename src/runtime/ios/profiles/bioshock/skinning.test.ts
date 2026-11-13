import { expect, test } from "vite-plus/test";
import { skinVertices } from "./skinning";
function fixture(weighted: boolean) {
  const vertices = new Uint8Array(weighted ? 40 : 36),
    matrices = new Uint8Array(16384);
  const output = new Uint8Array(40).fill(0xa5);
  const v = new DataView(vertices.buffer),
    m = new DataView(matrices.buffer);
  for (const [index, value] of [1, -2, 3].entries()) v.setFloat32(index * 4, value, true);
  vertices.set([255, 0, 128, 255, 0, 255, 128, 1, 128, 128, 255, 17], 12);
  vertices.set([1, 2, 3, 4, 0xff, 0xfe, 0xfd, 0xfc], 24);
  vertices[32] = 255;
  if (weighted) vertices[36] = 255;
  for (let bone = 0; bone < 256; bone++) {
    for (const diagonal of [0, 20, 40, 60]) m.setFloat32(bone * 64 + diagonal, 1, true);
  }
  for (const [index, value] of [10, 20, 30].entries())
    m.setFloat32(255 * 64 + 48 + index * 4, value, true);
  return { vertices, matrices, output, m };
}
test("rigid and weighted skinning transform positions and preserve packed attributes", () => {
  for (const weighted of [false, true]) {
    const f = fixture(weighted);
    skinVertices(f.vertices, f.matrices, f.output, 1, weighted);
    const result = new DataView(f.output.buffer);
    expect([
      result.getFloat32(0, true),
      result.getFloat32(4, true),
      result.getFloat32(8, true),
    ]).toEqual([11, 18, 33]);
    expect([...f.output.subarray(12, 24)]).toEqual([
      255, 0, 128, 0, 0, 255, 128, 0, 128, 128, 255, 0,
    ]);
    expect(f.output.subarray(24, 32)).toEqual(f.vertices.subarray(24, 32));
    expect([...f.output.subarray(32)]).toEqual(Array(8).fill(0xa5));
  }
});
test("all four weights contribute in source order without normalization", () => {
  const f = fixture(true);
  f.vertices.set([0, 1, 2, 3], 32);
  f.vertices.set([255, 255, 255, 255], 36);
  for (let bone = 0; bone < 4; bone++) f.m.setFloat32(bone * 64 + 48, bone + 1, true);
  skinVertices(f.vertices, f.matrices, f.output, 1, true);
  const result = new DataView(f.output.buffer);
  expect([
    result.getFloat32(0, true),
    result.getFloat32(4, true),
    result.getFloat32(8, true),
  ]).toEqual([14, -8, 12]);
});
test("skinning validates extents before changing output and handles empty input", () => {
  const f = fixture(false),
    before = f.output.slice();
  for (const count of [-1, 0.5, Infinity, 2])
    expect(() => skinVertices(f.vertices, f.matrices, f.output, count, false)).toThrow(RangeError);
  expect(() => skinVertices(f.vertices, f.matrices.subarray(0, 64), f.output, 1, false)).toThrow(
    RangeError,
  );
  expect(f.output).toEqual(before);
  skinVertices(new Uint8Array(), f.matrices, f.output, 0, false);
  expect(f.output).toEqual(before);
});
