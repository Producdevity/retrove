export const TciLimit = {
  Registers: 16,
  Environment: 14,
  Stack: 15,
  ConstantOperand: 255,
  WordBytes: 4,
  WordBits: 32,
  BlockBytes: 65_536,
  Instructions: 4096,
  BasicBlocks: 256,
};
export type Operand =
  | { readonly kind: "register"; readonly index: number }
  | { readonly kind: "constant"; readonly value: number };
export type Pair = readonly [Operand, Operand];
export type Comparison = "eq" | "ne" | "lt" | "ge" | "le" | "gt" | "ltu" | "geu" | "leu" | "gtu";
export type BinaryOperation =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "divu"
  | "rem"
  | "remu"
  | "and"
  | "or"
  | "xor"
  | "shl"
  | "shr"
  | "sar"
  | "rotl"
  | "rotr";
export type UnaryOperation =
  | "not"
  | "neg"
  | "ext8s"
  | "ext16s"
  | "ext8u"
  | "ext16u"
  | "bswap16"
  | "bswap32";
export type MemoryWidth = "byte" | "half" | "word";
export interface TciAbi {
  readonly opcodes: ReadonlyMap<number, string>;
  readonly comparisons: ReadonlyMap<number, Comparison>;
}
export type Operation =
  | { readonly kind: "move"; readonly destination: number; readonly value: Operand }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperation;
      readonly destination: number;
      readonly left: Operand;
      readonly right: Operand;
    }
  | {
      readonly kind: "unary";
      readonly operator: UnaryOperation;
      readonly destination: number;
      readonly value: Operand;
    }
  | {
      readonly kind: "host-load";
      readonly destination: number;
      readonly base: Operand;
      readonly offset: number;
      readonly width: MemoryWidth;
      readonly signed: boolean;
    }
  | {
      readonly kind: "host-store";
      readonly value: Operand;
      readonly base: Operand;
      readonly offset: number;
      readonly width: MemoryWidth;
    }
  | {
      readonly kind: "compare";
      readonly destination: number;
      readonly left: Pair;
      readonly right: Pair;
      readonly condition: Comparison;
      readonly wide: boolean;
    }
  | { readonly kind: "branch"; readonly target: number }
  | {
      readonly kind: "conditional";
      readonly target: number;
      readonly left: Pair;
      readonly right: Pair;
      readonly condition: Comparison;
      readonly wide: boolean;
    }
  | {
      readonly kind: "deposit";
      readonly destination: number;
      readonly left: Operand;
      readonly right: Operand;
      readonly position: number;
      readonly width: number;
    }
  | {
      readonly kind: "pair";
      readonly operator: "add" | "sub" | "mul";
      readonly low: number;
      readonly high: number;
      readonly left: Pair;
      readonly right: Pair;
    }
  | { readonly kind: "call"; readonly target: Operand }
  | {
      readonly kind: "guest-load";
      readonly destinations: readonly number[];
      readonly address: Operand;
      readonly mode: number;
    }
  | {
      readonly kind: "guest-store";
      readonly value: Pair;
      readonly address: Operand;
      readonly mode: number;
    }
  | { readonly kind: "jump"; readonly cell: number }
  | { readonly kind: "exit"; readonly value: number }
  | { readonly kind: "barrier" };
export interface TciInstruction {
  readonly address: number;
  readonly next: number;
  readonly operation: Operation;
}
export interface TciBlock {
  readonly address: number;
  readonly instructions: readonly TciInstruction[];
}
export class UnsupportedTciOperation extends Error {}
