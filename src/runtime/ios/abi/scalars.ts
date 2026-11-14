export const WORD_BYTES = 4;
export const GeometryField = { X: 0, Y: 1, Width: 2, Height: 3 } as const;
const scratch = new DataView(new ArrayBuffer(WORD_BYTES));
export function floatFromBits(value: number): number {
  scratch.setUint32(0, value, true);
  return scratch.getFloat32(0, true);
}
export function floatBits(value: number): number {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
}

const doubleScratch = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
export function doubleFromBits(low: number, high: number): number {
  doubleScratch.setUint32(0, low, true);
  doubleScratch.setUint32(WORD_BYTES, high, true);
  return doubleScratch.getFloat64(0, true);
}
export function doubleBits(value: number): bigint {
  doubleScratch.setFloat64(0, value, true);
  return doubleScratch.getBigUint64(0, true);
}
