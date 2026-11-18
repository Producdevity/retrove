import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
const Field = { A: 0, B: 1, C: 2, D: 3, TX: 4, TY: 5 } as const;
const TRANSFORM_FLOATS = 6;
const POINT_FLOATS = 2;
const RECT_FLOATS = 4;
export type AffineTransform = readonly [number, number, number, number, number, number];
type Store = (destination: number, values: readonly number[]) => number;
export function affineArguments(args: GuestArguments, first = 0): AffineTransform {
  const read = (field: number) => floatFromBits(args(first + field));
  return [
    read(Field.A),
    read(Field.B),
    read(Field.C),
    read(Field.D),
    read(Field.TX),
    read(Field.TY),
  ];
}
const floats = (args: GuestArguments, first: number, count: number) =>
  Array.from({ length: count }, (_, index) => floatFromBits(args(first + index)));
/** t1 then t2, as CGAffineTransformConcat(t1, t2). */
export function concat(t1: AffineTransform, t2: AffineTransform): AffineTransform {
  const [a, b, c, d, tx, ty] = t1,
    [a2, b2, c2, d2, tx2, ty2] = t2;
  return [
    a * a2 + b * c2,
    a * b2 + b * d2,
    c * a2 + d * c2,
    c * b2 + d * d2,
    tx * a2 + ty * c2 + tx2,
    tx * b2 + ty * d2 + ty2,
  ];
}
/** The inverse, or the transform unchanged when it is singular, as CoreGraphics does. */
export function invert(t: AffineTransform): AffineTransform {
  const [a, b, c, d, tx, ty] = t,
    det = a * d - b * c;
  if (det === 0) return t;
  return [d / det, -b / det, -c / det, a / det, (c * ty - d * tx) / det, (b * tx - a * ty) / det];
}
export function applyToPoint(t: AffineTransform, x: number, y: number): [number, number] {
  const [a, b, c, d, tx, ty] = t;
  return [a * x + c * y + tx, b * x + d * y + ty];
}
/** The bounding box of the transformed rect. */
export function applyToRect(
  t: AffineTransform,
  rect: readonly [number, number, number, number],
): [number, number, number, number] {
  const [x, y, width, height] = rect;
  const corners = [
    applyToPoint(t, x, y),
    applyToPoint(t, x + width, y),
    applyToPoint(t, x, y + height),
    applyToPoint(t, x + width, y + height),
  ];
  const xs = corners.map(([px]) => px),
    ys = corners.map(([, py]) => py);
  const left = Math.min(...xs),
    top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}
const rotation = (radians: number): AffineTransform => {
  const sin = Math.sin(radians),
    cos = Math.cos(radians);
  return [cos, sin, -sin, cos, 0, 0];
};

/** Struct results above four bytes return through the pointer in r0, so inputs start at r1. */
export function affineImports(store: Store): Record<string, (args: GuestArguments) => number> {
  return {
    _CGAffineTransformIsIdentity: (args) => {
      const [a, b, c, d, tx, ty] = affineArguments(args);
      return Number(a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0);
    },
    _CGAffineTransformEqualToTransform: (args) => {
      const left = affineArguments(args),
        right = affineArguments(args, TRANSFORM_FLOATS);
      return Number(left.every((value, index) => value === right[index]));
    },
    _CGAffineTransformMake: (args) => store(args(0), floats(args, 1, TRANSFORM_FLOATS)),
    _CGAffineTransformMakeTranslation: (args) =>
      store(args(0), [1, 0, 0, 1, ...floats(args, 1, POINT_FLOATS)]),
    _CGAffineTransformRotate: (args) =>
      store(
        args(0),
        concat(rotation(floatFromBits(args(1 + TRANSFORM_FLOATS))), affineArguments(args, 1)),
      ),
    _CGAffineTransformConcat: (args) =>
      store(args(0), concat(affineArguments(args, 1), affineArguments(args, 1 + TRANSFORM_FLOATS))),
    _CGAffineTransformInvert: (args) => store(args(0), invert(affineArguments(args, 1))),
    _CGPointApplyAffineTransform: (args) => {
      const [x = 0, y = 0] = floats(args, 1, POINT_FLOATS);
      return store(args(0), applyToPoint(affineArguments(args, 1 + POINT_FLOATS), x, y));
    },
    _CGSizeApplyAffineTransform: (args) => {
      const [width = 0, height = 0] = floats(args, 1, POINT_FLOATS),
        [a, b, c, d] = affineArguments(args, 1 + POINT_FLOATS);
      return store(args(0), [a * width + c * height, b * width + d * height]);
    },
    _CGRectApplyAffineTransform: (args) => {
      const [x = 0, y = 0, width = 0, height = 0] = floats(args, 1, RECT_FLOATS);
      return store(
        args(0),
        applyToRect(affineArguments(args, 1 + RECT_FLOATS), [x, y, width, height]),
      );
    },
  };
}
