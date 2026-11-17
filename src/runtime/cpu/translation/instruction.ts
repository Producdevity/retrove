import type { VectorInstruction } from "./vector-instruction";

export const Condition = { Always: 14, Unconditional: 15 } as const;
export const ShiftType = { LSL: 0, LSR: 1, ASR: 2, ROR: 3 } as const;
export const DataOp = {
  AND: 0,
  EOR: 1,
  SUB: 2,
  RSB: 3,
  ADD: 4,
  ADC: 5,
  SBC: 6,
  RSC: 7,
  TST: 8,
  TEQ: 9,
  CMP: 10,
  CMN: 11,
  ORR: 12,
  MOV: 13,
  BIC: 14,
  MVN: 15,
} as const;
/** ORN has no ARM data-processing opcode; the translator handles it as an extra opcode. */
export const ThumbDataOp = { ORN: 16 } as const;
export const Register = { SP: 13, LR: 14, PC: 15 } as const;
export const RegisterCount = 16;

export type Operand =
  | { readonly kind: "imm"; readonly value: number; readonly carry: 0 | 1 | undefined }
  | { readonly kind: "reg"; readonly rm: number; readonly shift: number; readonly amount: number }
  | { readonly kind: "rshift"; readonly rm: number; readonly shift: number; readonly rs: number };

export type MemoryOffset =
  | { readonly kind: "imm"; readonly value: number }
  | { readonly kind: "reg"; readonly rm: number; readonly shift: number; readonly amount: number };

export type ExtendForm = "b" | "h" | "b16";
export type ReverseForm = "word" | "half" | "signedHalf" | "bits";
export const AccessBytes = { Byte: 1, Half: 2, Word: 4 } as const;
export type TransferSize = (typeof AccessBytes)[keyof typeof AccessBytes];

type DataInstruction = {
  readonly kind: "data";
  readonly op: number;
  readonly s: boolean;
  readonly rn: number;
  readonly rd: number;
  readonly operand: Operand;
};
type MultiplyInstruction =
  | {
      readonly kind: "mul";
      readonly accumulate: "none" | "add" | "sub";
      readonly s: boolean;
      readonly rd: number;
      readonly rn: number;
      readonly rm: number;
      readonly ra: number;
    }
  | {
      readonly kind: "div";
      readonly signed: boolean;
      readonly rd: number;
      readonly rn: number;
      readonly rm: number;
    }
  | {
      readonly kind: "mulhigh";
      readonly rd: number;
      readonly rn: number;
      readonly rm: number;
      readonly ra?: number;
      readonly subtract: boolean;
      readonly round: boolean;
    }
  | {
      readonly kind: "mull";
      readonly signed: boolean;
      readonly accumulate: boolean;
      readonly lo: number;
      readonly hi: number;
      readonly rn: number;
      readonly rm: number;
    }
  | {
      readonly kind: "mulhalf";
      readonly rd: number;
      readonly rn: number;
      readonly rm: number;
      readonly ra?: number;
      readonly nTop: boolean;
      readonly mTop: boolean;
    };
type BitInstruction =
  | {
      readonly kind: "extend";
      readonly signed: boolean;
      readonly form: ExtendForm;
      readonly rd: number;
      readonly rm: number;
      readonly rotate: number;
      readonly rn?: number;
    }
  | {
      readonly kind: "bitfield";
      readonly rd: number;
      readonly rn: number | undefined;
      readonly lsb: number;
      readonly width: number;
    }
  | {
      readonly kind: "extract";
      readonly signed: boolean;
      readonly rd: number;
      readonly rn: number;
      readonly lsb: number;
      readonly width: number;
    }
  | { readonly kind: "movw" | "movt"; readonly rd: number; readonly value: number }
  | { readonly kind: "clz"; readonly rd: number; readonly rm: number }
  | {
      readonly kind: "reverse";
      readonly form: ReverseForm;
      readonly rd: number;
      readonly rm: number;
    }
  | { readonly kind: "tls"; readonly rd: number };
type MemoryInstruction =
  | {
      readonly kind: "mem";
      readonly load: boolean;
      readonly size: TransferSize;
      readonly signed: boolean;
      readonly rn: number;
      readonly rd: number;
      readonly offset: MemoryOffset;
      readonly add: boolean;
      readonly pre: boolean;
      readonly writeback: boolean;
    }
  | {
      readonly kind: "multiple";
      readonly load: boolean;
      readonly rn: number;
      readonly registers: readonly number[];
      readonly increment: boolean;
      readonly before: boolean;
      readonly writeback: boolean;
    }
  | {
      readonly kind: "pair";
      readonly load: boolean;
      readonly rn: number;
      readonly rt: number;
      readonly rt2: number;
      readonly offset: MemoryOffset;
      readonly add: boolean;
      readonly pre: boolean;
      readonly writeback: boolean;
    }
  | {
      readonly kind: "exclusive";
      readonly load: boolean;
      readonly rn: number;
      readonly rt: number;
      readonly rd: number;
      readonly offset: number;
    };
type ControlInstruction =
  | { readonly kind: "branch"; readonly link: boolean; readonly target: number }
  | { readonly kind: "bx"; readonly link: boolean; readonly rm: number }
  | {
      readonly kind: "cbz";
      readonly nonzero: boolean;
      readonly rn: number;
      readonly target: number;
    }
  | {
      readonly kind: "table";
      readonly rn: number;
      readonly rm: number;
      readonly half: boolean;
      readonly base: number;
    }
  | { readonly kind: "unsupported" };

export type Instruction = { readonly cond: number } & (
  | DataInstruction
  | MultiplyInstruction
  | BitInstruction
  | MemoryInstruction
  | ControlInstruction
  | VectorInstruction
);
export type InstructionKind = Instruction["kind"];
export type InstructionOf<K extends InstructionKind> = Extract<Instruction, { kind: K }>;

export const unsupported = (cond: number): Instruction => ({ cond, kind: "unsupported" });
export const nop = (): Instruction => ({
  cond: Condition.Always,
  kind: "data",
  op: DataOp.MOV,
  s: false,
  rn: 0,
  rd: 0,
  operand: { kind: "reg", rm: 0, shift: 0, amount: 0 },
});
