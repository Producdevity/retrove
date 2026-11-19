/** Integer word layout used by the emitted code. */
export const Word = {
  Bytes: 4,
  Bits: 32,
  SignShift: 31,
  Byte: 0xff,
  Half: 0xffff,
  HalfBits: 16,
  ByteBits: 8,
  Sign: 0x80000000,
  Magnitude: 0x7fffffff,
  All: 0xffffffff,
} as const;

/** IEEE single-precision bit patterns. */
export const Single = {
  Exponent: 0x7f800000,
  /** Exponent all-ones after shifting out the sign: values above this are NaN, equal is infinity. */
  ShiftedInfinity: 0xff000000,
  /** Subnormal or zero after shifting out the sign and subtracting 2. */
  ShiftedSubnormal: 0x00fffffe,
  /** Subnormal, zero or the smallest normal after shifting out the sign and subtracting 2. */
  ShiftedTiny: 0x00ffffff,
  ShiftedBias: 2,
  ExponentShift: 23,
  DefaultNaN: 0x7fc00000,
  /** 2^-126, the smallest normal single. */
  FlushThreshold: 1.1754943508222875e-38,
} as const;

/** IEEE double-precision bit patterns. */
export const Double = {
  Sign: -0x8000000000000000n,
  Exponent: 0x7ff0000000000000n,
  DefaultNaN: 0x7ff8000000000000n,
  HighShift: 32n,
  Round: 0x80000000n,
  /** 2^-1022, the smallest normal double. */
  Minimum: 2.2250738585072014e-308,
} as const;

/** Guest VFP/NEON state is cached as 32-bit lanes: S0..S63 overlay D0..D31. */
export const Lanes = {
  Architectural: 64,
  /** Internal lanes past the architectural ones live only in Wasm locals. */
  Scalar: 64,
  Product: 65,
  PerDouble: 2,
  PerQuad: 4,
  DoubleRegisters: 32,
} as const;

/** How a translated function leaves through its shared epilogue. */
export const ExitKind = { Return: 0, Tail: 1, Fail: 2 } as const;

export const FunctionType = 0;
export const DispatchIndex = 0;
export const FirstTranslated = 1;
/** Probes into the foreign code table before leaving to the interpreter. */
export const ForeignProbes = 8;
/** Clears the Thumb bit of a guest PC. */
export const ClearThumb = ~1;
/** Label table entries are i32 per halfword slot: the slot offset is the halfword offset doubled. */
export const LabelSlotShift = 1;
