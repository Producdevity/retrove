import type { ThumbInstruction } from "./instruction";
import { Thumb } from "./instruction";
const Field = {
  LowRegister: 7,
  NarrowOffsetShift: 6,
  NarrowOffsetMask: 0x1f,
  MinimumListRegisters: 2,
  Register: 0xf,
  HighRegister: 8,
  HighShift: 4,
  SourceShift: 3,
  DestinationShift: 8,
  ImmediateByte: 0xff,
  ImmediateHalf: 0xffff,
  ImmediateHighShift: 12,
  ImmediateExtraBit: 0x400,
  ImmediateExtraShift: 1,
  ImmediateMidMask: 0x7000,
  ImmediateMidShift: 4,
  RegisterHighShift: 12,
  RotatePrefix: 0xc00,
  RotateShift: 7,
  Mantissa: 0x7f,
  MantissaTop: 0x80,
  WordBits: 32,
  ReplicateShift: 8,
  ByteSpacing: 16,
  TopByteShift: 24,
};
const Encoding = {
  NarrowLoadMask: 0xf800,
  NarrowLoad: 0x6800,
  MultipleLoadMask: 0xfff0,
  MultipleLoad: 0xe890,
  MultipleForbidden: 0xa000,
  RegisterAddMask: 0xff00,
  RegisterAdd: 0x4400,
  StackAddMask: 0xf800,
  StackAdd: 0xa800,
  WideMask: 0xfbf0,
  MoveLow: 0xf240,
  MoveHigh: 0xf2c0,
  AddImmediate: 0xf100,
  PointerMask: 0xfff0,
  PointerLoad: 0xf8d0,
  OffsetMask: 0xfff,
  Reserved: 0x8000,
};
function immediate(first: number, second: number): number {
  return (
    ((first & Field.ImmediateExtraBit) << Field.ImmediateExtraShift) |
    ((second & Field.ImmediateMidMask) >>> Field.ImmediateMidShift) |
    (second & Field.ImmediateByte)
  );
}
function expand(value: number): number {
  if (value & Field.RotatePrefix) {
    const amount = value >>> Field.RotateShift,
      bits = Field.MantissaTop | (value & Field.Mantissa);
    return ((bits >>> amount) | (bits << (Field.WordBits - amount))) >>> 0;
  }
  const byte = value & Field.ImmediateByte;
  const repetition = value >>> Field.ReplicateShift;
  if (repetition && !byte) throw new Error("Unpredictable Thumb immediate.");
  if (repetition === 0) return byte;
  if (repetition === 1) return byte | (byte << Field.ByteSpacing);
  const repeated = (byte << Field.ReplicateShift) | (byte << Field.TopByteShift);
  return (
    (repetition === Thumb.Lanes ? repeated : repeated | byte | (byte << Field.ByteSpacing)) >>> 0
  );
}
export function decodeAddress(first: number, second?: number): ThumbInstruction | undefined {
  if (second === undefined) {
    if ((first & Encoding.NarrowLoadMask) === Encoding.NarrowLoad)
      return {
        kind: "load-pointer",
        destination: first & Field.LowRegister,
        base: (first >>> Field.SourceShift) & Field.LowRegister,
        immediate: ((first >>> Field.NarrowOffsetShift) & Field.NarrowOffsetMask) * Thumb.WordBytes,
      };
    if ((first & Encoding.RegisterAddMask) === Encoding.RegisterAdd)
      return {
        kind: "add-register",
        destination:
          (first & Field.LowRegister) | ((first >>> Field.HighShift) & Field.HighRegister),
        source: (first >>> Field.SourceShift) & Field.Register,
      };
    if ((first & Encoding.StackAddMask) === Encoding.StackAdd)
      return {
        kind: "add-immediate",
        destination: (first >>> Field.DestinationShift) & Field.LowRegister,
        base: Thumb.Stack,
        immediate: (first & Field.ImmediateByte) * Thumb.WordBytes,
      };
    return undefined;
  }
  if ((first & Encoding.MultipleLoadMask) === Encoding.MultipleLoad) {
    const base = first & Field.Register;
    if (base === Thumb.PC || second & Encoding.MultipleForbidden) return undefined;
    const destinations = Array.from({ length: Thumb.PC }, (_, index) => index).filter(
      (index) => second & (1 << index),
    );
    if (destinations.length < Field.MinimumListRegisters) return undefined;
    return { kind: "load-pointers", base, destinations };
  }
  if ((first & Encoding.PointerMask) === Encoding.PointerLoad)
    return {
      kind: "load-pointer",
      destination: second >>> Field.RegisterHighShift,
      base: first & Field.Register,
      immediate: second & Encoding.OffsetMask,
    };
  if (second & Encoding.Reserved) return undefined;
  const pattern = first & Encoding.WideMask,
    destination = (second >>> Field.DestinationShift) & Field.Register;
  if (pattern === Encoding.MoveLow || pattern === Encoding.MoveHigh)
    return {
      kind: pattern === Encoding.MoveLow ? "move-low" : "move-high",
      destination,
      immediate: ((first & Field.Register) << Field.ImmediateHighShift) | immediate(first, second),
    };
  if (pattern === Encoding.AddImmediate)
    return {
      kind: "add-immediate",
      destination,
      base: first & Field.Register,
      immediate: expand(immediate(first, second)),
    };
  return undefined;
}
