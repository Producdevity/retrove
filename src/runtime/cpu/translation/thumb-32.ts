import {
  ExclusiveBytes,
  RegisterCount,
  Register,
  unsupported,
  type Instruction,
} from "./instruction";
import { decodeThumbExclusive } from "./decode-exclusive";
import { bit, field, flag, registerList } from "./bits";
import { decodeThumbBranch, decodeThumbImmediate } from "./thumb-32-immediate";
import { decodeThumbRegister } from "./thumb-32-register";
import { ThumbPipeline, register, wideData } from "./thumb-shared";
import { decodeThumbCoprocessor } from "./thumb-coprocessor";

const Field = {
  Op1: { shift: 11, width: 2 },
  Op2: { shift: 4, width: 7 },
  Rn: { shift: 0, width: 4 },
  Rt: { shift: 12, width: 4 },
  Rt2: { shift: 8, width: 4 },
  Rm: { shift: 0, width: 4 },
  Imm8: { shift: 0, width: 8 },
  Mode: { shift: 7, width: 2 },
  WideOp: { shift: 5, width: 4 },
  ShiftType: { shift: 4, width: 2 },
  AmountHigh: { shift: 12, width: 3 },
  AmountLow: { shift: 6, width: 2 },
} as const;
const Op1 = { LoadStore: 0b01, Immediate: 0b10 } as const;
const Op2 = {
  MultipleMask: 0b1100100,
  Multiple: 0b0000000,
  Dual: 0b0000100,
  ShiftedMask: 0b1100000,
  Shifted: 0b0100000,
} as const;
const Bit = {
  Branch: 15,
  Pre: 8,
  Up: 7,
  Dual: 6,
  Writeback: 5,
  Load: 4,
  S: 4,
  TableHalf: 4,
} as const;
const Mode = { Increment: 1, Decrement: 2 } as const;
const Encoding = {
  TableMask: 0xfff0,
  Table: 0xe8d0,
  TableSecondMask: 0xffe0,
  TableSecond: 0xf000,
  ExclusiveMask: 0xfff0,
  LoadExclusive: 0xe850,
  StoreExclusive: 0xe840,
} as const;
const WordScale = 4;
const AmountHighShift = 2;
const HalfwordBits = 16;

/** 32-bit Thumb-2 instruction made of halfwords `h1`, `h2` at `pc`. */
export function decodeThumb32(h1: number, h2: number, pc: number, cond: number): Instruction {
  const w = ((h1 << HalfwordBits) | h2) >>> 0;
  const op1 = field(h1, Field.Op1),
    op2 = field(h1, Field.Op2);
  if (op1 === Op1.LoadStore) {
    if ((op2 & Op2.MultipleMask) === Op2.Multiple) return loadStoreMultiple(h1, h2, cond);
    if ((op2 & Op2.MultipleMask) === Op2.Dual) return loadStoreDual(h1, h2, pc, cond);
    if ((op2 & Op2.ShiftedMask) === Op2.Shifted) {
      const amount = (field(h2, Field.AmountHigh) << AmountHighShift) | field(h2, Field.AmountLow);
      const operand = register(field(h2, Field.Rm), field(h2, Field.ShiftType), amount);
      const s = flag(h1, Bit.S);
      return wideData(
        field(h1, Field.WideOp),
        s,
        field(h1, Field.Rn),
        field(h2, Field.Rt2),
        operand,
        cond,
      );
    }
    return decodeThumbCoprocessor(w, cond);
  }
  if (op1 === Op1.Immediate) {
    const branch = flag(h2, Bit.Branch);
    return branch ? decodeThumbBranch(h1, h2, pc, cond) : decodeThumbImmediate(h1, h2, pc, cond);
  }
  return decodeThumbRegister(h1, h2, cond, op2, w);
}

function loadStoreMultiple(h1: number, h2: number, cond: number): Instruction {
  const mode = field(h1, Field.Mode),
    registers = registerList(h2, RegisterCount);
  if ((mode !== Mode.Increment && mode !== Mode.Decrement) || !registers.length)
    return unsupported(cond);
  return {
    cond,
    kind: "multiple",
    load: flag(h1, Bit.Load),
    rn: field(h1, Field.Rn),
    registers,
    increment: mode === Mode.Increment,
    before: mode === Mode.Decrement,
    writeback: flag(h1, Bit.Writeback),
  };
}

function loadStoreDual(h1: number, h2: number, pc: number, cond: number): Instruction {
  const p = bit(h1, Bit.Pre),
    u = bit(h1, Bit.Up),
    wb = bit(h1, Bit.Writeback),
    load = flag(h1, Bit.Load),
    rn = field(h1, Field.Rn);
  const rt = field(h2, Field.Rt),
    offset = field(h2, Field.Imm8) * WordScale;
  if (
    (h1 & Encoding.TableMask) === Encoding.Table &&
    (h2 & Encoding.TableSecondMask) === Encoding.TableSecond
  ) {
    const half = flag(h2, Bit.TableHalf);
    return { cond, kind: "table", rn, rm: field(h2, Field.Rm), half, base: pc + ThumbPipeline };
  }
  if (flag(h1, Bit.Dual) && (p || wb)) {
    if (rn === Register.PC) return unsupported(cond);
    return {
      cond,
      kind: "pair",
      load,
      rn,
      rt,
      rt2: field(h2, Field.Rt2),
      offset: { kind: "imm", value: offset },
      add: !!u,
      pre: !!p,
      writeback: !!wb,
    };
  }
  const word = {
    cond,
    kind: "exclusive",
    size: ExclusiveBytes.Word,
    rn,
    rt,
    rt2: 0,
    offset,
  } as const;
  if ((h1 & Encoding.ExclusiveMask) === Encoding.LoadExclusive)
    return { ...word, load: true, rd: 0 };
  if ((h1 & Encoding.ExclusiveMask) === Encoding.StoreExclusive)
    return { ...word, load: false, rd: field(h2, Field.Rt2) };
  return decodeThumbExclusive(h1, h2, cond) ?? unsupported(cond);
}
