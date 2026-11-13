import type { BinaryOperation, Comparison, Operation, Pair, Operand } from "../model";
import { Op } from "./abi";
import type { Emitter } from "./emitter";

const BINARY: Readonly<Record<BinaryOperation, number>> = {
  add: 0x6a,
  sub: 0x6b,
  mul: 0x6c,
  div: 0x6d,
  divu: 0x6e,
  rem: 0x6f,
  remu: 0x70,
  and: 0x71,
  or: 0x72,
  xor: 0x73,
  shl: 0x74,
  sar: 0x75,
  shr: 0x76,
  rotl: 0x77,
  rotr: 0x78,
};
const COMPARISON: Readonly<Record<Comparison, { readonly word: number; readonly wide: number }>> = {
  eq: { word: 0x46, wide: 0x51 },
  ne: { word: 0x47, wide: 0x52 },
  lt: { word: 0x48, wide: 0x53 },
  ltu: { word: 0x49, wide: 0x54 },
  gt: { word: 0x4a, wide: 0x55 },
  gtu: { word: 0x4b, wide: 0x56 },
  le: { word: 0x4c, wide: 0x57 },
  leu: { word: 0x4d, wide: 0x58 },
  ge: { word: 0x4e, wide: 0x59 },
  geu: { word: 0x4f, wide: 0x5a },
};
const WORD_BYTES = 4;
const DESTINATION_BYTE_DIRECTION = 2;
const BYTE_MASK = 0xff;
const HALF_MASK = 0xffff;
const BYTE_BITS = 8;

export function comparison(
  code: Emitter,
  left: Pair,
  right: Pair,
  kind: Comparison,
  wide: boolean,
): void {
  if (wide) code.pair(left).pair(right);
  else code.operand(left[0]).operand(right[0]);
  code.add(wide ? COMPARISON[kind].wide : COMPARISON[kind].word);
}
function swap(code: Emitter, value: Operand, half: boolean): void {
  if (half) {
    code.operand(value).integer(BYTE_MASK).add(Op.And).integer(BYTE_BITS).add(Op.Shl);
    code.operand(value).integer(BYTE_BITS).add(Op.Shr).integer(BYTE_MASK).add(Op.And, Op.Or);
  } else {
    for (let index = 0; index < WORD_BYTES; index++) {
      const shift = (WORD_BYTES - 1 - DESTINATION_BYTE_DIRECTION * index) * BYTE_BITS;
      code
        .operand(value)
        .integer(BYTE_MASK << (index * BYTE_BITS))
        .add(Op.And);
      code.integer(Math.abs(shift)).add(shift < 0 ? Op.Shr : Op.Shl);
      if (index) code.add(Op.Or);
    }
  }
}
function unary(code: Emitter, operation: Extract<Operation, { kind: "unary" }>): void {
  const { operator, value } = operation;
  if (operator === "bswap16" || operator === "bswap32") swap(code, value, operator === "bswap16");
  else if (operator === "neg") code.integer(0).operand(value).add(Op.Sub);
  else {
    code.operand(value);
    switch (operator) {
      case "not":
        code.integer(-1).add(Op.Xor);
        break;
      case "ext8s":
        code.add(Op.ExtendByte);
        break;
      case "ext16s":
        code.add(Op.ExtendHalf);
        break;
      case "ext8u":
        code.integer(BYTE_MASK).add(Op.And);
        break;
      case "ext16u":
        code.integer(HALF_MASK).add(Op.And);
        break;
    }
  }
  code.destination(operation.destination);
}
export function arithmetic(code: Emitter, operation: Operation): boolean {
  switch (operation.kind) {
    case "move":
      code.operand(operation.value).destination(operation.destination);
      break;
    case "binary":
      code.operand(operation.left).operand(operation.right).add(BINARY[operation.operator]);
      code.destination(operation.destination);
      break;
    case "unary":
      unary(code, operation);
      break;
    case "compare":
      comparison(code, operation.left, operation.right, operation.condition, operation.wide);
      code.destination(operation.destination);
      break;
    case "deposit": {
      const mask = ((1 << operation.width) - 1) << operation.position;
      code.operand(operation.left).integer(~mask).add(Op.And);
      code.operand(operation.right).integer(operation.position).add(Op.Shl);
      code.integer(mask).add(Op.And, Op.Or).destination(operation.destination);
      break;
    }
    case "pair":
      code.pair(operation.left).pair(operation.right);
      code.add(
        operation.operator === "add"
          ? Op.WideAdd
          : operation.operator === "sub"
            ? Op.WideSub
            : Op.WideMul,
      );
      code.wideResult(operation.low, operation.high);
      break;
    default:
      return false;
  }
  return true;
}
