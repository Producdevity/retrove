const MINIMUM_NORMAL = 1.1754943508222875e-38;
const UINT32_LIMIT = 0x1_0000_0000;
const UINT32_MAXIMUM = 0xffff_ffff;

export function runFast(value: number): number {
  const rounded = Math.fround(value);
  if (Number.isNaN(rounded)) return NaN;
  if (Math.abs(rounded) >= MINIMUM_NORMAL) return rounded;
  return rounded < 0 || Object.is(rounded, -0) ? -0 : 0;
}

export function unsignedFloatToInteger(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  return value >= UINT32_LIMIT ? UINT32_MAXIMUM : Math.trunc(value);
}
