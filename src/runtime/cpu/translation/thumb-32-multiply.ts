import { field, flag } from "./bits";
import { Register, unsupported, type Instruction } from "./instruction";

const Op2 = {
  GroupMask: 0b1111000,
  Multiply: 0b0110000,
  Long: 0b0111000,
} as const;
const Field = {
  Rn: { shift: 0, width: 4 },
  Ra: { shift: 12, width: 4 },
  Rd: { shift: 8, width: 4 },
  Rm: { shift: 0, width: 4 },
  Op: { shift: 4, width: 3 },
  Op2: { shift: 4, width: 2 },
  LongOp2: { shift: 4, width: 4 },
  HighReserved: { shift: 5, width: 3 },
} as const;
const Op = {
  Plain: 0b000,
  MostSignificant: 0b101,
  MostSignificantSubtract: 0b110,
  SignedDivide: 0b001,
  UnsignedDivide: 0b011,
  Unsigned: 0b010,
  Accumulate: 0b100,
} as const;
const Op2Value = { Accumulate: 0, Subtract: 1, Divide: 0b1111, Long: 0 } as const;
const RoundBit = 4;

/** Thumb-2 multiply, multiply-accumulate, long multiply and divide; undefined outside those groups. */
export function decodeThumbMultiply(
  h1: number,
  h2: number,
  cond: number,
  op2: number,
): Instruction | undefined {
  const rn = field(h1, Field.Rn),
    rm = field(h2, Field.Rm),
    op = field(h1, Field.Op);
  if ((op2 & Op2.GroupMask) === Op2.Multiply) {
    const ra = field(h2, Field.Ra),
      rd = field(h2, Field.Rd),
      kind = field(h2, Field.Op2);
    if (
      (op === Op.MostSignificant || op === Op.MostSignificantSubtract) &&
      field(h2, Field.HighReserved) === 0
    ) {
      const subtract = op === Op.MostSignificantSubtract;
      if (subtract && ra === Register.PC) return unsupported(cond);
      const accumulate = ra === Register.PC ? {} : { ra };
      const round = flag(h2, RoundBit);
      return { cond, kind: "mulhigh", rd, rn, rm, ...accumulate, subtract, round };
    }
    if (op !== Op.Plain) return unsupported(cond);
    if (kind === Op2Value.Accumulate) {
      const accumulate = ra === Register.PC ? "none" : "add";
      return { cond, kind: "mul", accumulate, s: false, rd, rn, rm, ra };
    }
    if (kind === Op2Value.Subtract)
      return { cond, kind: "mul", accumulate: "sub", s: false, rd, rn, rm, ra };
    return unsupported(cond);
  }
  if ((op2 & Op2.GroupMask) === Op2.Long) {
    const kind = field(h2, Field.LongOp2),
      lo = field(h2, Field.Ra),
      hi = field(h2, Field.Rd);
    if (op === Op.SignedDivide && kind === Op2Value.Divide)
      return { cond, kind: "div", signed: true, rd: hi, rn, rm };
    if (op === Op.UnsignedDivide && kind === Op2Value.Divide)
      return { cond, kind: "div", signed: false, rd: hi, rn, rm };
    if (kind === Op2Value.Long && !(op & 1)) {
      const signed = !(op & Op.Unsigned),
        accumulate = !!(op & Op.Accumulate);
      return { cond, kind: "mull", signed, accumulate, lo, hi, rn, rm };
    }
    return unsupported(cond);
  }
  return undefined;
}
