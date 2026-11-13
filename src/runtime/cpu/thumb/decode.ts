import type { DecodedThumb } from "./instruction";
import { Thumb } from "./instruction";
import { decodeFloat } from "./decode-float";
import { decodeAddress } from "./decode-address";
const Wide = { Mask: 0xf800, Minimum: 0xe800 };
export function decodeThumb(code: DataView, offset: number): DecodedThumb {
  const first = code.getUint16(offset, true);
  const wide = (first & Wide.Mask) >= Wide.Minimum;
  const second = wide ? code.getUint16(offset + Thumb.HalfBytes, true) : undefined;
  const instruction =
    (second === undefined ? undefined : decodeFloat(first, second)) ?? decodeAddress(first, second);
  if (!instruction)
    throw new Error(`Unsupported straight-line Thumb instruction at byte ${offset}.`);
  return { instruction, bytes: wide ? Thumb.WordBytes : Thumb.HalfBytes };
}
