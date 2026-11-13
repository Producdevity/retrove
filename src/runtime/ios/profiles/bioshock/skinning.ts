import { runFast as f, unsignedFloatToInteger } from "../../../cpu/run-fast";

export const SkinningLayout = {
  RigidBytes: 36,
  SoftBytes: 40,
  OutputBytes: 40,
  MatrixBytes: 64,
  BoneCount: 256,
};
const FLOAT_BYTES = 4;
const POSITION_BYTES = 12;
const MATRIX_ROW_BYTES = 16;
const MATRIX_Z_BYTES = 32;
const MATRIX_TRANSLATION_BYTES = 48;
const NORMAL_COUNT = 3;
const PACKED_MIDPOINT = 127.5;
const BYTE_MASK = 0xff;
const NORMAL_SCALE = Math.fround(1 / PACKED_MIDPOINT);
const WEIGHT_SCALE = Math.fround(1 / BYTE_MASK);
const BONE_OFFSET = 32;
const WEIGHT_OFFSET = 36;
const WEIGHT_COUNT = 4;
const UV_OFFSET = 24;
const UV_BYTES = 8;
const Z_COMPONENT_BYTES = 8;
const PACKED_Z_OFFSET = 2;
interface Vector {
  x: number;
  y: number;
  z: number;
}
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function transform(matrices: DataView, bone: number, column: number, vector: Vector): number {
  const at = bone + column;
  const x = f(f(matrices.getFloat32(at, true)) * vector.x);
  const y = f(f(matrices.getFloat32(at + MATRIX_ROW_BYTES, true)) * vector.y);
  const z = f(f(matrices.getFloat32(at + MATRIX_Z_BYTES, true)) * vector.z);
  return f(f(x + y) + z);
}
function loadVector(input: DataView, at: number, position: boolean, result: Vector): void {
  if (position) {
    result.x = f(input.getFloat32(at, true));
    result.y = f(input.getFloat32(at + FLOAT_BYTES, true));
    result.z = f(input.getFloat32(at + Z_COMPONENT_BYTES, true));
  } else {
    result.x = f(f(input.getUint8(at) * NORMAL_SCALE) - 1);
    result.y = f(f(input.getUint8(at + 1) * NORMAL_SCALE) - 1);
    result.z = f(f(input.getUint8(at + PACKED_Z_OFFSET) * NORMAL_SCALE) - 1);
  }
}
function pack(value: number): number {
  return unsignedFloatToInteger(f(f(value * PACKED_MIDPOINT) + PACKED_MIDPOINT)) & BYTE_MASK;
}
function storeVector(output: DataView, at: number, position: boolean, result: Vector): void {
  if (position) {
    output.setFloat32(at, result.x, true);
    output.setFloat32(at + FLOAT_BYTES, result.y, true);
    output.setFloat32(at + Z_COMPONENT_BYTES, result.z, true);
  } else {
    output.setUint8(at, pack(result.x));
    output.setUint8(at + 1, pack(result.y));
    output.setUint8(at + PACKED_Z_OFFSET, pack(result.z));
    output.setUint8(at + NORMAL_COUNT, 0);
  }
}
function component(
  input: DataView,
  at: number,
  matrices: DataView,
  vector: Vector,
  column: number,
  position: boolean,
  weighted: boolean,
): number {
  let result = 0;
  const bones = weighted ? WEIGHT_COUNT : 1;
  for (let index = 0; index < bones; index++) {
    const bone = input.getUint8(at + BONE_OFFSET + index) * SkinningLayout.MatrixBytes;
    let transformed = transform(matrices, bone, column, vector);
    if (position)
      transformed = f(
        f(matrices.getFloat32(bone + MATRIX_TRANSLATION_BYTES + column, true)) + transformed,
      );
    if (!weighted) return transformed;
    const weight = f(input.getUint8(at + WEIGHT_OFFSET + index) * WEIGHT_SCALE);
    result = f(result + f(transformed * weight));
  }
  return result;
}
export function requiredBoneBytes(vertices: Uint8Array, count: number, weighted: boolean): number {
  const input = view(vertices);
  const stride = weighted ? SkinningLayout.SoftBytes : SkinningLayout.RigidBytes;
  const bones = weighted ? WEIGHT_COUNT : 1;
  let maximum = -1;
  for (let vertex = 0; vertex < count; vertex++)
    for (let index = 0; index < bones; index++)
      maximum = Math.max(maximum, input.getUint8(vertex * stride + BONE_OFFSET + index));
  return (maximum + 1) * SkinningLayout.MatrixBytes;
}
export function skinVertices(
  vertices: Uint8Array,
  matrices: Uint8Array,
  output: Uint8Array,
  count: number,
  weighted: boolean,
): void {
  const stride = weighted ? SkinningLayout.SoftBytes : SkinningLayout.RigidBytes;
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    vertices.length < count * stride ||
    output.length < count * SkinningLayout.OutputBytes
  )
    throw new RangeError("Invalid vertex skinning buffers.");
  if (matrices.length < requiredBoneBytes(vertices, count, weighted))
    throw new RangeError("Vertex bone index is outside the matrix palette.");
  const input = view(vertices),
    bones = view(matrices),
    destination = view(output);
  const vector: Vector = { x: 0, y: 0, z: 0 },
    result: Vector = { x: 0, y: 0, z: 0 };
  for (let vertex = 0; vertex < count; vertex++) {
    const at = vertex * stride,
      to = vertex * SkinningLayout.OutputBytes;
    for (let index = 0; index <= NORMAL_COUNT; index++) {
      const position = index === 0;
      const offset = position ? 0 : POSITION_BYTES + (index - 1) * FLOAT_BYTES;
      loadVector(input, at + offset, position, vector);
      result.x = component(input, at, bones, vector, 0, position, weighted);
      result.y = component(input, at, bones, vector, FLOAT_BYTES, position, weighted);
      result.z = component(input, at, bones, vector, Z_COMPONENT_BYTES, position, weighted);
      storeVector(destination, to + offset, position, result);
    }
    output.set(vertices.subarray(at + UV_OFFSET, at + UV_OFFSET + UV_BYTES), to + UV_OFFSET);
  }
}
