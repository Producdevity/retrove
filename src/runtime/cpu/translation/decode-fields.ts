/** ARM (A1) encoding fields shared by the ARM, VFP and Advanced SIMD decoders. */
export const ArmField = {
  Cond: { shift: 28, width: 4 },
  Group: { shift: 25, width: 3 },
  Opcode: { shift: 21, width: 4 },
  Rn: { shift: 16, width: 4 },
  Rd: { shift: 12, width: 4 },
  Rs: { shift: 8, width: 4 },
  Rm: { shift: 0, width: 4 },
  ShiftType: { shift: 5, width: 2 },
  ShiftAmount: { shift: 7, width: 5 },
  Imm12: { shift: 0, width: 12 },
  Imm8: { shift: 0, width: 8 },
  MultiplyOp: { shift: 20, width: 5 },
  Top: { shift: 24, width: 4 },
  MediaOp: { shift: 20, width: 3 },
  ExtendRotate: { shift: 10, width: 2 },
  Bits7To6: { shift: 6, width: 2 },
  Msb: { shift: 16, width: 5 },
  Opc1: { shift: 21, width: 2 },
  Opc2: { shift: 5, width: 2 },
  Size: { shift: 18, width: 2 },
  NeonImm3: { shift: 19, width: 3 },
} as const;

export const ArmBit = {
  Link: 24,
  Pre: 24,
  Unsigned: 24,
  Up: 23,
  Byte: 22,
  Immediate: 22,
  Double: 22,
  Writeback: 21,
  Load: 20,
  S: 20,
  Register: 4,
  Multiply: 7,
  NTop: 5,
  MTop: 6,
  Round: 5,
  Extract: 22,
  Divide: 21,
  High: 7,
  Q: 6,
  M: 5,
  N: 7,
  Sz: 8,
  Op6: 6,
} as const;

/** VFP register numbers combine a four-bit field with one extra bit: D = extra:field, S = field:extra. */
export const VfpRegister = { DoubleExtraShift: 4, SingleFieldShift: 1 } as const;

export function vfpRegister(value: number, extra: number, double: boolean): number {
  return double
    ? (extra << VfpRegister.DoubleExtraShift) | value
    : (value << VfpRegister.SingleFieldShift) | extra;
}
