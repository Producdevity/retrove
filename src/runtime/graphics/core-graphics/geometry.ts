import type { GuestArguments } from "../../ios/objc/host";
import { currentMediaTime } from "../../ios/uikit/animation/transactions";
import { affineImports } from "./affine";

// ARMv7 public CoreGraphics functions use the base AAPCS float register layout.
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const RECT_FLOATS = 4;
const POINT_FLOATS = 2;
const TRANSFORM_AND_POINT_FLOATS = 8;
const TRANSFORM_FLOATS = 6;
const HALF = 2;
const Rect = { X: 0, Width: 2, Height: 3 } as const;
const Scale = { X: 1, Y: 2 } as const;
const UI_WINDOW_LEVEL_ALERT = 2000;
export interface GeometryHost {
  write(address: number, bytes: Uint8Array): void;
}
export interface GeometryHeap {
  zero(size: number): number;
}
type Edges = readonly [left: number, top: number, right: number, bottom: number];
export type GeometryImport = (args: GuestArguments) => number | bigint;

const scratch = new DataView(new ArrayBuffer(FLOAT_BYTES));
const decode = (bits: number) => {
  scratch.setUint32(0, bits, true);
  return scratch.getFloat32(0, true);
};
const encode = (value: number) => {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
};
const floats = (args: GuestArguments, count: number, first = 0) =>
  Array.from({ length: count }, (_, index) => decode(args(index + first)));
const rect = (args: GuestArguments, first = 0) => {
  const [x = 0, y = 0, width = 0, height = 0] = floats(args, RECT_FLOATS, first);
  return { x, y, width, height };
};
const edges = (args: GuestArguments, first = 0): Edges => {
  const { x, y, width, height } = rect(args, first);
  return [
    Math.min(x, x + width),
    Math.min(y, y + height),
    Math.max(x, x + width),
    Math.max(y, y + height),
  ];
};

type Store = (destination: number, values: readonly number[]) => number;
function rectImports(store: Store): Record<string, GeometryImport> {
  return {
    _CGRectIsNull: (a) => Number(decode(a(0)) === Infinity || decode(a(1)) === Infinity),
    _CGRectIsEmpty: (a) =>
      Number(
        decode(a(Rect.Width)) === 0 ||
          decode(a(Rect.Height)) === 0 ||
          decode(a(Rect.X)) === Infinity,
      ),
    _CGRectIntersectsRect: (a) => {
      const [l0, l1, l2, l3] = edges(a),
        [r0, r1, r2, r3] = edges(a, RECT_FLOATS);
      return Number(Math.max(l0, r0) < Math.min(l2, r2) && Math.max(l1, r1) < Math.min(l3, r3));
    },
    _CGRectIntegral: (a) => {
      const [x, y, right, bottom] = edges(a, 1);
      if (x === Infinity || y === Infinity) return store(a(0), [Infinity, Infinity, 0, 0]);
      return store(a(0), [
        Math.floor(x),
        Math.floor(y),
        Math.ceil(right) - Math.floor(x),
        Math.ceil(bottom) - Math.floor(y),
      ]);
    },
    _CGRectOffset: (a) => {
      const { x, y, width, height } = rect(a, 1);
      const [dx = 0, dy = 0] = floats(a, POINT_FLOATS, 1 + RECT_FLOATS);
      return store(a(0), [x + dx, y + dy, width, height]);
    },
    _CGAffineTransformMakeRotation: (a) => {
      const radians = decode(a(1)),
        sin = Math.sin(radians),
        cos = Math.cos(radians);
      return store(a(0), [cos, sin, -sin, cos, 0, 0]);
    },
    _CGRectContainsPoint: (a) => {
      const [left, top, right, bottom] = edges(a),
        [x = 0, y = 0] = floats(a, POINT_FLOATS, RECT_FLOATS);
      return Number(x >= left && x < right && y >= top && y < bottom);
    },
    _CGRectContainsRect: (a) => {
      const [l0, t0, r0, b0] = edges(a),
        [l1, t1, r1, b1] = edges(a, RECT_FLOATS);
      return Number(l1 >= l0 && t1 >= t0 && r1 <= r0 && b1 <= b0);
    },
    _CGRectInset: (a) => {
      const [left, top, right, bottom] = edges(a, 1),
        [dx = 0, dy = 0] = floats(a, POINT_FLOATS, 1 + RECT_FLOATS);
      if (left + dx > right - dx || top + dy > bottom - dy)
        return store(a(0), [Infinity, Infinity, 0, 0]);
      return store(a(0), [left + dx, top + dy, right - left - dx - dx, bottom - top - dy - dy]);
    },
  };
}

export function geometry(cpu: GeometryHost, heap: GeometryHeap) {
  const store = (destination: number, values: readonly number[]) => {
    const view = new DataView(new ArrayBuffer(values.length * FLOAT_BYTES));
    values.forEach((value, index) => view.setFloat32(index * FLOAT_BYTES, value, true));
    cpu.write(destination, new Uint8Array(view.buffer));
    return destination;
  };
  const constants = new Map<string, number>();
  for (const [name, values] of [
    ["_CGPointZero", [0, 0]],
    ["_CGRectZero", [0, 0, 0, 0]],
    ["_CGSizeZero", [0, 0]],
    ["_CGRectNull", [Infinity, Infinity, 0, 0]],
    ["_CGAffineTransformIdentity", [1, 0, 0, 1, 0, 0]],
    ["_UIWindowLevelAlert", [UI_WINDOW_LEVEL_ALERT]],
  ] as const)
    constants.set(name, store(heap.zero(values.length * FLOAT_BYTES), values));
  const funcs: Record<string, GeometryImport> = {
    _CACurrentMediaTime: () => currentMediaTime(),
    ...affineImports(store),
    ...rectImports(store),
    _CGAffineTransformScale: (a) => {
      const [xx = 0, xy = 0, yx = 0, yy = 0, tx = 0, ty = 0] = floats(a, TRANSFORM_FLOATS, 1),
        [sx = 1, sy = 1] = floats(a, POINT_FLOATS, 1 + TRANSFORM_FLOATS);
      return store(a(0), [xx * sx, xy * sx, yx * sy, yy * sy, tx, ty]);
    },
    _CGAffineTransformMakeScale: (a) =>
      store(a(0), [decode(a(Scale.X)), 0, 0, decode(a(Scale.Y)), 0, 0]),
    _CGAffineTransformTranslate: (a) => {
      const [xx = 0, xy = 0, yx = 0, yy = 0, tx = 0, ty = 0, x = 0, y = 0] = floats(
        a,
        TRANSFORM_AND_POINT_FLOATS,
        1,
      );
      return store(a(0), [xx, xy, yx, yy, tx + xx * x + yx * y, ty + xy * x + yy * y]);
    },
  };
  const getters: Record<string, (edges: Edges) => number> = {
    Width: ([left, , right]) => right - left,
    MinX: ([left]) => left,
    MaxY: ([, , , bottom]) => bottom,
    Height: ([, top, , bottom]) => bottom - top,
    MinY: ([, top]) => top,
    MaxX: ([, , right]) => right,
    MidX: ([left, , right]) => (left + right) / HALF,
    MidY: ([, top, , bottom]) => (top + bottom) / HALF,
  };
  for (const [key, getter] of Object.entries(getters))
    funcs[`_CGRectGet${key}`] = (a) => encode(getter(edges(a)));
  return { constants, funcs };
}
