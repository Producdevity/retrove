import { expect, test } from "vite-plus/test";
import { floatBits } from "../../ios/abi/scalars";
import { installFixedFunction } from "./imports";
import { GL, type GraphicsCall } from "./host";

function fixture() {
  const memory = new Uint8Array(4096),
    errors: number[] = [],
    forwarded: number[][] = [];
  const api: Record<string, GraphicsCall | undefined> = {
    _glGetFloatv: (args) => {
      forwarded.push([args(0), args(1)]);
    },
    _glDrawArrays: (args) => {
      forwarded.push([args(0), args(1), args(2)]);
    },
  };
  let context = 1,
    renderingAPI = 1;
  const close = installFixedFunction({
    api,
    currentAPI: () => renderingAPI,
    currentContext: () => context,
    boundArray: () => 0,
    gl: () => {
      throw new Error("A state-only test must not allocate a graphics context.");
    },
    read: (pointer, length) => memory.slice(pointer, pointer + length),
    write: (pointer, bytes) => memory.set(bytes, pointer),
    string: () => 0,
    error: (code) => errors.push(code),
  });
  const call = (name: string, ...args: number[]): unknown => {
    const fn = api[`_gl${name}`];
    if (!fn) throw new Error(`Missing test operation ${name}`);
    return fn((index) => args[index] ?? 0);
  };
  return {
    call,
    close,
    errors,
    forwarded,
    memory,
    context: (id: number) => {
      context = id;
    },
    api: (id: number) => {
      renderingAPI = id;
    },
  };
}
test("guest fixed-point matrices and state queries preserve signed values and context isolation", () => {
  const x = fixture(),
    view = new DataView(x.memory.buffer);
  x.call("Translatex", 65536, -131072, 196608);
  x.call("GetFloatv", 0x0ba6, 128);
  expect([
    view.getFloat32(176, true),
    view.getFloat32(180, true),
    view.getFloat32(184, true),
  ]).toEqual([1, -2, 3]);
  x.context(2);
  x.call("GetFloatv", 0x0ba6, 128);
  expect(view.getFloat32(176, true)).toBe(0);
  x.context(1);
  x.call("MatrixMode", 0x1701);
  x.call("Orthof", ...[0, 10, 0, 10, -1, 1].map(floatBits));
  x.call("GetFixedv", 0x0ba7, 256);
  expect(view.getInt32(256, true)).toBe(13107);
  x.call("MatrixMode", 0);
  expect(x.errors).toEqual([GL.InvalidEnum]);
  x.call("GetIntegerv", 0x0ba0, 512);
  expect(view.getUint32(512, true)).toBe(0x1701);
  x.close();
});
test("invalid ES1 projections preserve the matrix and ES2 calls retain their existing implementation", () => {
  const x = fixture(),
    view = new DataView(x.memory.buffer);
  x.call("Frustumf", ...[0, 0, -1, 1, 1, 10].map(floatBits));
  expect(x.errors).toEqual([GL.InvalidValue]);
  x.call("GetFloatv", 0x0ba6, 128);
  expect(view.getFloat32(128, true)).toBe(1);
  x.api(2);
  x.call("GetFloatv", 0x0ba6, 1024);
  x.call("DrawArrays", 4, 0, 3);
  expect(x.forwarded).toEqual([
    [0x0ba6, 1024],
    [4, 0, 3],
  ]);
  x.close();
});
