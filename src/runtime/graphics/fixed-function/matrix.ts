export const MATRIX_WIDTH = 4;
export const MATRIX_ELEMENTS = MATRIX_WIDTH * MATRIX_WIDTH;
const DOUBLE = 2;
const HALF_TURN_DEGREES = 180;
const Axis = { X: 0, Y: 1, Z: 2, W: 3 } as const;
export type Vector4 = readonly [number, number, number, number];

export function identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function element(matrix: Float32Array, row: number, column: number): number {
  const value = matrix[column * MATRIX_WIDTH + row];
  if (value === undefined) throw new Error("Expected a four by four matrix.");
  return value;
}
export function multiply(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(MATRIX_ELEMENTS);
  for (let column = 0; column < MATRIX_WIDTH; column++) {
    for (let row = 0; row < MATRIX_WIDTH; row++) {
      let value = 0;
      for (let shared = 0; shared < MATRIX_WIDTH; shared++)
        value += element(left, row, shared) * element(right, shared, column);
      result[column * MATRIX_WIDTH + row] = value;
    }
  }
  return result;
}
export function transform(matrix: Float32Array, [x, y, z, w]: Vector4): Vector4 {
  const row = (index: number): number =>
    element(matrix, index, Axis.X) * x +
    element(matrix, index, Axis.Y) * y +
    element(matrix, index, Axis.Z) * z +
    element(matrix, index, Axis.W) * w;
  return [row(Axis.X), row(Axis.Y), row(Axis.Z), row(Axis.W)];
}
export function translation(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
export function scaling(x: number, y: number, z: number): Float32Array {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}
export function rotation(degrees: number, x: number, y: number, z: number): Float32Array {
  const length = Math.hypot(x, y, z);
  if (!length) return identity();
  x /= length;
  y /= length;
  z /= length;
  const radians = (degrees * Math.PI) / HALF_TURN_DEGREES;
  const c = Math.cos(radians),
    s = Math.sin(radians),
    t = 1 - c;
  return new Float32Array([
    x * x * t + c,
    y * x * t + z * s,
    z * x * t - y * s,
    0,
    x * y * t - z * s,
    y * y * t + c,
    z * y * t + x * s,
    0,
    x * z * t + y * s,
    y * z * t - x * s,
    z * z * t + c,
    0,
    0,
    0,
    0,
    1,
  ]);
}
export interface ProjectionVolume {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
}
function validVolume(volume: ProjectionVolume): boolean {
  return volume.left !== volume.right && volume.bottom !== volume.top && volume.near !== volume.far;
}
export function orthographic(volume: ProjectionVolume): Float32Array | undefined {
  if (!validVolume(volume)) return undefined;
  const { left, right, bottom, top, near, far } = volume;
  return new Float32Array([
    DOUBLE / (right - left),
    0,
    0,
    0,
    0,
    DOUBLE / (top - bottom),
    0,
    0,
    0,
    0,
    -DOUBLE / (far - near),
    0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    1,
  ]);
}
export function frustum(volume: ProjectionVolume): Float32Array | undefined {
  if (!validVolume(volume) || volume.near <= 0 || volume.far <= 0) return undefined;
  const { left, right, bottom, top, near, far } = volume;
  return new Float32Array([
    (DOUBLE * near) / (right - left),
    0,
    0,
    0,
    0,
    (DOUBLE * near) / (top - bottom),
    0,
    0,
    (right + left) / (right - left),
    (top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    -1,
    0,
    0,
    (-DOUBLE * far * near) / (far - near),
    0,
  ]);
}
