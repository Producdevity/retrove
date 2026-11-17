import { ByteBits, field, flag } from "./bits";
import {
  DataOp,
  Register,
  nop,
  unsupported,
  type ExtendForm,
  type Instruction,
  type ReverseForm,
  type TransferSize,
} from "./instruction";
import { decodeThumbMultiply } from "./thumb-32-multiply";
import { decodeThumbCoprocessor } from "./thumb-coprocessor";
import { data, transfer } from "./thumb-shared";

const Op2 = {
  CoprocessorMask: 0b1110001,
  Coprocessor: 0b0010000,
  MemoryMask: 0b1110000,
  Memory: 0b0000000,
  MemoryOddMask: 0b1100111,
  MemoryOdd1: 0b0000001,
  MemoryOdd3: 0b0000011,
  MemoryOdd5: 0b0000101,
  RegisterMask: 0b1110000,
  Register: 0b0100000,
  Simd: 0b1000000,
} as const;
const Field = {
  Rn: { shift: 0, width: 4 },
  Rt: { shift: 12, width: 4 },
  Rd: { shift: 8, width: 4 },
  Rm: { shift: 0, width: 4 },
  Size: { shift: 5, width: 2 },
  Imm12: { shift: 0, width: 12 },
  Imm8: { shift: 0, width: 8 },
  Reserved: { shift: 6, width: 5 },
  Amount: { shift: 4, width: 2 },
  Op1: { shift: 4, width: 4 },
  Op2: { shift: 4, width: 4 },
  Rotate: { shift: 4, width: 2 },
} as const;
const Bit = { Load: 4, Signed: 8, Up: 7, Indexed: 11, Pre: 10, Add: 9, Writeback: 8 } as const;
const Sizes: Partial<Record<number, TransferSize>> = { 0: 1, 1: 2, 2: 4 };
const WordSize = 4;
const Data = {
  Ones: 0xf000,
  Extend: 0b1000,
  Group: 0b1100,
  Misc: 0b1000,
  Low: 0b11,
  OpShift: 2,
  Forms: 0b111,
} as const;
const ExtendForms: Partial<Record<number, { signed: boolean; form: ExtendForm }>> = {
  0b000: { signed: true, form: "h" },
  0b001: { signed: false, form: "h" },
  0b010: { signed: true, form: "b16" },
  0b011: { signed: false, form: "b16" },
  0b100: { signed: true, form: "b" },
  0b101: { signed: false, form: "b" },
};
const MiscForms: Partial<Record<number, "clz" | ReverseForm>> = {
  0b1100: "clz",
  0b0100: "word",
  0b0101: "half",
  0b0111: "signedHalf",
  0b0110: "bits",
};

/** Thumb-2 op1 = 0b11: single loads and stores, register data processing, multiplies and coprocessor space. */
export function decodeThumbRegister(
  h1: number,
  h2: number,
  cond: number,
  op2: number,
  w: number,
): Instruction {
  if ((op2 & Op2.CoprocessorMask) === Op2.Coprocessor) return decodeThumbCoprocessor(w, cond);
  const odd = op2 & Op2.MemoryOddMask;
  if (
    (op2 & Op2.MemoryMask) === Op2.Memory ||
    odd === Op2.MemoryOdd1 ||
    odd === Op2.MemoryOdd3 ||
    odd === Op2.MemoryOdd5
  )
    return singleMemory(h1, h2, cond);
  if ((op2 & Op2.RegisterMask) === Op2.Register) return dataRegister(h1, h2, cond);
  const multiply = decodeThumbMultiply(h1, h2, cond, op2);
  if (multiply) return multiply;
  if (op2 & Op2.Simd) return decodeThumbCoprocessor(w, cond);
  return unsupported(cond);
}

function singleMemory(h1: number, h2: number, cond: number): Instruction {
  const load = flag(h1, Bit.Load),
    size = Sizes[field(h1, Field.Size)],
    signed = flag(h1, Bit.Signed),
    rn = field(h1, Field.Rn),
    rt = field(h2, Field.Rt);
  if (!size || (signed && (!load || size === WordSize))) return unsupported(cond);
  if (load && rt === Register.PC && size !== WordSize) return nop();
  if (rn === Register.PC) {
    if (!load) return unsupported(cond);
    const offset = field(h2, Field.Imm12);
    return transfer(cond, true, size, signed, Register.PC, rt, offset, flag(h1, Bit.Up));
  }
  if (flag(h1, Bit.Up)) return transfer(cond, load, size, signed, rn, rt, field(h2, Field.Imm12));
  if (flag(h2, Bit.Indexed)) {
    const p = flag(h2, Bit.Pre),
      u = flag(h2, Bit.Add),
      wb = flag(h2, Bit.Writeback);
    if (!p && !wb) return unsupported(cond);
    if (p && u && !wb) return unsupported(cond);
    return transfer(cond, load, size, signed, rn, rt, field(h2, Field.Imm8), u, p, wb);
  }
  if (field(h2, Field.Reserved) !== 0) return unsupported(cond);
  const offset = {
    kind: "reg",
    rm: field(h2, Field.Rm),
    shift: 0,
    amount: field(h2, Field.Amount),
  } as const;
  return transfer(cond, load, size, signed, rn, rt, offset);
}

function dataRegister(h1: number, h2: number, cond: number): Instruction {
  const rn = field(h1, Field.Rn),
    rd = field(h2, Field.Rd),
    rm = field(h2, Field.Rm),
    op1 = field(h1, Field.Op1),
    op2 = field(h2, Field.Op2);
  if ((h2 & Data.Ones) !== Data.Ones) return unsupported(cond);
  if (!(op1 & Data.Extend) && op2 === 0)
    return data(cond, DataOp.MOV, !!(op1 & 1), 0, rd, {
      kind: "rshift",
      rm: rn,
      rs: rm,
      shift: op1 >> 1,
    });
  if (!(op1 & Data.Extend) && op2 & Data.Extend) {
    const rotate = field(h2, Field.Rotate) * ByteBits;
    const form = ExtendForms[op1 & Data.Forms];
    const added = rn === Register.PC ? {} : { rn };
    return form
      ? { cond, kind: "extend", signed: form.signed, form: form.form, rd, rm, rotate, ...added }
      : unsupported(cond);
  }
  if ((op1 & Data.Group) === Data.Misc && (op2 & Data.Group) === Data.Misc) {
    const form = MiscForms[((op1 & Data.Low) << Data.OpShift) | (op2 & Data.Low)];
    if (form === "clz") return { cond, kind: "clz", rd, rm };
    if (form) return { cond, kind: "reverse", form, rd, rm };
  }
  return unsupported(cond);
}
