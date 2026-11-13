import type { ThumbInstruction } from "./instruction";
import { Thumb } from "./instruction";
const Field = {
  RegisterMask: 0xf,
  RegisterShift: 12,
  ExtraRegisterBit: 0x40,
  ExtraRegister: 16,
  LeftExtraBit: 0x80,
  RightExtraBit: 0x20,
  OffsetMask: 0xff,
  PositiveBit: 0x80,
  DoubleBit: 0x100,
  ExtraSingleShift: 6,
};
const Encoding = {
  MemoryMask: 0xff20,
  Memory: 0xed00,
  CoprocessorMask: 0x0e00,
  Coprocessor: 0x0a00,
  LoadBit: 0x10,
  VectorFirstMask: 0xffb0,
  VectorSecondMask: 0x0f50,
  Add: 0xef00,
  Subtract: 0xef20,
  Multiply: 0xff00,
  Copy: 0xef20,
  Arithmetic: 0x0d00,
  Product: 0x0d10,
  Bitwise: 0x0110,
};
function memory(first: number, second: number): ThumbInstruction | undefined {
  if (
    (first & Encoding.MemoryMask) !== Encoding.Memory ||
    (second & Encoding.CoprocessorMask) !== Encoding.Coprocessor
  )
    return undefined;
  const extended = (first & Field.ExtraRegisterBit) !== 0;
  const baseRegister = second >>> Field.RegisterShift;
  const double = (second & Field.DoubleBit) !== 0;
  const lane = double
    ? (baseRegister + (extended ? Field.ExtraRegister : 0)) * Thumb.Lanes
    : baseRegister * Thumb.Lanes + Number(extended);
  return {
    kind: first & Encoding.LoadBit ? "load-float" : "store-float",
    base: first & Field.RegisterMask,
    offset: (second & Field.OffsetMask) * Thumb.WordBytes * (first & Field.PositiveBit ? 1 : -1),
    lane,
    lanes: double ? Thumb.Lanes : 1,
  };
}
export function decodeFloat(first: number, second: number): ThumbInstruction | undefined {
  const access = memory(first, second);
  if (access) return access;
  const high = first & Encoding.VectorFirstMask,
    low = second & Encoding.VectorSecondMask;
  const kind =
    high === Encoding.Add && low === Encoding.Arithmetic
      ? "add-float"
      : high === Encoding.Subtract && low === Encoding.Arithmetic
        ? "subtract-float"
        : high === Encoding.Multiply && low === Encoding.Product
          ? "multiply-float"
          : high === Encoding.Copy && low === Encoding.Bitwise
            ? "copy-float"
            : undefined;
  if (!kind) return undefined;
  const destination =
    (second >>> Field.RegisterShift) + (first & Field.ExtraRegisterBit ? Field.ExtraRegister : 0);
  const left =
    (first & Field.RegisterMask) + (second & Field.LeftExtraBit ? Field.ExtraRegister : 0);
  const right =
    (second & Field.RegisterMask) + (second & Field.RightExtraBit ? Field.ExtraRegister : 0);
  if (kind === "copy-float" && left !== right) return undefined;
  return {
    kind,
    destination: destination * Thumb.Lanes,
    left: left * Thumb.Lanes,
    right: right * Thumb.Lanes,
  };
}
