import { ByteBits, WordBits, field, flag } from "./bits";
import { ArmBit, ArmField } from "./decode-fields";
import {
  Register,
  unsupported,
  type ExtendForm,
  type Instruction,
  type ReverseForm,
} from "./instruction";

const Encoding = {
  ExtendMask: 0x0f8003f0,
  Extend: 0x06800070,
  MulHighMask: 0x0ff00010,
  MulHigh: 0x07500010,
  BitfieldMask: 0x0fe00070,
  Bitfield: 0x07c00010,
  ExtractMask: 0x0fa00070,
  Extract: 0x07a00050,
  DivideMask: 0x0fd0f0f0,
  Divide: 0x0710f010,
  ReverseMask: 0x0fff0ff0,
} as const;
const MulHighForm = { Add: 0b00, Reserved1: 0b01, Reserved2: 0b10, Subtract: 0b11 } as const;

const ExtendForms: Partial<Record<number, { signed: boolean; form: ExtendForm }>> = {
  0b000: { signed: true, form: "b16" },
  0b010: { signed: true, form: "b" },
  0b011: { signed: true, form: "h" },
  0b100: { signed: false, form: "b16" },
  0b110: { signed: false, form: "b" },
  0b111: { signed: false, form: "h" },
};
const ReverseForms: Partial<Record<number, ReverseForm>> = {
  0x06bf0f30: "word",
  0x06bf0fb0: "half",
  0x06ff0fb0: "signedHalf",
  0x06ff0f30: "bits",
};

/** ARMv6/v7 media instructions: extends, multiply-high, bitfields, divide and byte reversal. */
export function decodeMedia(w: number, cond: number): Instruction {
  const rd = field(w, ArmField.Rd),
    rm = field(w, ArmField.Rm);
  if ((w & Encoding.ExtendMask) === Encoding.Extend) {
    const form = ExtendForms[field(w, ArmField.MediaOp)],
      rn = field(w, ArmField.Rn);
    if (form) {
      const rotate = field(w, ArmField.ExtendRotate) * ByteBits;
      const added = rn === Register.PC ? {} : { rn };
      return {
        cond,
        kind: "extend",
        signed: form.signed,
        form: form.form,
        rd,
        rm,
        rotate,
        ...added,
      };
    }
  }
  const high = field(w, ArmField.Bits7To6);
  if (
    (w & Encoding.MulHighMask) === Encoding.MulHigh &&
    !(high === MulHighForm.Reserved1 || high === MulHighForm.Reserved2)
  ) {
    const ra = field(w, ArmField.Rd),
      subtract = high === MulHighForm.Subtract;
    if (subtract && ra === Register.PC) return unsupported(cond);
    const accumulate = ra === Register.PC ? {} : { ra };
    return {
      cond,
      kind: "mulhigh",
      rd: field(w, ArmField.Rn),
      rn: rm,
      rm: field(w, ArmField.Rs),
      ...accumulate,
      subtract,
      round: flag(w, ArmBit.Round),
    };
  }
  const lsb = field(w, ArmField.ShiftAmount);
  if ((w & Encoding.BitfieldMask) === Encoding.Bitfield) {
    const msb = field(w, ArmField.Msb);
    if (msb < lsb) return unsupported(cond);
    const rn = rm === Register.PC ? undefined : rm;
    return { cond, kind: "bitfield", rd, rn, lsb, width: msb - lsb + 1 };
  }
  if ((w & Encoding.ExtractMask) === Encoding.Extract) {
    const width = field(w, ArmField.Msb) + 1;
    if (lsb + width > WordBits) return unsupported(cond);
    return { cond, kind: "extract", signed: !flag(w, ArmBit.Extract), rd, rn: rm, lsb, width };
  }
  if ((w & Encoding.DivideMask) === Encoding.Divide) {
    const signed = !flag(w, ArmBit.Divide);
    return {
      cond,
      kind: "div",
      signed,
      rd: field(w, ArmField.Rn),
      rn: rm,
      rm: field(w, ArmField.Rs),
    };
  }
  const form = ReverseForms[w & Encoding.ReverseMask];
  if (form) return { cond, kind: "reverse", form, rd, rm };
  return unsupported(cond);
}
