import { bit, field, flag, registerList } from "./bits";
import { DataOp, Register, nop, unsupported, type Instruction } from "./instruction";
import { ThumbPipeline, data, immediate } from "./thumb-shared";

const Encoding = {
  StackAdjustMask: 0xff00,
  StackAdjust: 0xb000,
  CompareBranchMask: 0xf500,
  CompareBranch: 0xb100,
  ExtendMask: 0xff00,
  Extend: 0xb200,
  PushPopMask: 0xfe00,
  Push: 0xb400,
  Pop: 0xbc00,
  ReverseMask: 0xffc0,
  ReverseWord: 0xba00,
  ReverseHalf: 0xba40,
  ReverseSignedHalf: 0xbac0,
  HintMask: 0xff0f,
  Hint: 0xbf00,
} as const;
const Field = {
  Low: { shift: 0, width: 3 },
  Middle: { shift: 3, width: 3 },
  Imm7: { shift: 0, width: 7 },
  Imm5: { shift: 3, width: 5 },
  ExtendForm: { shift: 6, width: 2 },
  List: { shift: 0, width: 8 },
} as const;
const Bit = { Subtract: 7, Nonzero: 11, OffsetHigh: 9, Load: 11, Extra: 8 } as const;
const OffsetHighShift = 6;
const WordScale = 4;
const LowRegisters = 8;
const SignedForms = 2;

/** Miscellaneous 16-bit Thumb instructions (0b1011xxxx). */
export function decodeThumbMisc(h: number, pc: number, cond: number): Instruction {
  const rd = field(h, Field.Low),
    rm = field(h, Field.Middle);
  if ((h & Encoding.StackAdjustMask) === Encoding.StackAdjust) {
    const op = flag(h, Bit.Subtract) ? DataOp.SUB : DataOp.ADD;
    const amount = immediate(field(h, Field.Imm7) * WordScale);
    return data(cond, op, false, Register.SP, Register.SP, amount);
  }
  if ((h & Encoding.CompareBranchMask) === Encoding.CompareBranch) {
    const offset = (bit(h, Bit.OffsetHigh) << OffsetHighShift) | (field(h, Field.Imm5) << 1);
    const target = (pc + ThumbPipeline + offset) | 1;
    return { cond, kind: "cbz", nonzero: flag(h, Bit.Nonzero), rn: rd, target };
  }
  if ((h & Encoding.ExtendMask) === Encoding.Extend) {
    const form = field(h, Field.ExtendForm);
    const width = form & 1 ? "b" : "h";
    return { cond, kind: "extend", signed: form < SignedForms, form: width, rd, rm, rotate: 0 };
  }
  const pushPop = h & Encoding.PushPopMask;
  if (pushPop === Encoding.Push || pushPop === Encoding.Pop) {
    const load = flag(h, Bit.Load),
      registers = registerList(field(h, Field.List), LowRegisters);
    if (flag(h, Bit.Extra)) registers.push(load ? Register.PC : Register.LR);
    if (!registers.length) return unsupported(cond);
    const rn = Register.SP;
    return {
      cond,
      kind: "multiple",
      load,
      rn,
      registers,
      increment: load,
      before: !load,
      writeback: true,
    };
  }
  const reverse = h & Encoding.ReverseMask;
  if (reverse === Encoding.ReverseWord) return { cond, kind: "reverse", form: "word", rd, rm };
  if (reverse === Encoding.ReverseHalf) return { cond, kind: "reverse", form: "half", rd, rm };
  if (reverse === Encoding.ReverseSignedHalf)
    return { cond, kind: "reverse", form: "signedHalf", rd, rm };
  if ((h & Encoding.HintMask) === Encoding.Hint) return nop();
  return unsupported(cond);
}
