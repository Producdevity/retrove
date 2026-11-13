import type { TciCursor } from "./cursor";
import {
  TciLimit,
  type BinaryOperation,
  type Operation,
  type Pair,
  type UnaryOperation,
} from "./model";
const binary = new Map<string, BinaryOperation>([
  ["add_i32", "add"],
  ["sub_i32", "sub"],
  ["mul_i32", "mul"],
  ["div_i32", "div"],
  ["divu_i32", "divu"],
  ["rem_i32", "rem"],
  ["remu_i32", "remu"],
  ["and_i32", "and"],
  ["or_i32", "or"],
  ["xor_i32", "xor"],
  ["shl_i32", "shl"],
  ["shr_i32", "shr"],
  ["sar_i32", "sar"],
  ["rotl_i32", "rotl"],
  ["rotr_i32", "rotr"],
]);
const unary = new Map<string, UnaryOperation>([
  ["not_i32", "not"],
  ["neg_i32", "neg"],
  ["ext8s_i32", "ext8s"],
  ["ext16s_i32", "ext16s"],
  ["ext8u_i32", "ext8u"],
  ["ext16u_i32", "ext16u"],
  ["bswap16_i32", "bswap16"],
  ["bswap32_i32", "bswap32"],
]);
const pair = new Map<string, "add" | "sub" | "mul">([
  ["add2_i32", "add"],
  ["sub2_i32", "sub"],
  ["mulu2_i32", "mul"],
]);
export function wordPair(cursor: TciCursor, immediate = false): Pair {
  return [immediate ? cursor.operand() : cursor.source(), { kind: "constant", value: 0 }];
}
function deposit(cursor: TciCursor): Operation {
  const destination = cursor.destination(),
    left = cursor.source(),
    right = cursor.source();
  const position = cursor.byte(),
    width = cursor.byte();
  if (width < 1 || width >= TciLimit.WordBits || position + width > TciLimit.WordBits)
    throw new RangeError("Invalid TCI bitfield.");
  return { kind: "deposit", destination, left, right, position, width };
}
export function decodeArithmetic(name: string, cursor: TciCursor): Operation | undefined {
  if (name === "mov_i32" || name === "movi_i32") {
    const destination = cursor.destination();
    const value =
      name === "mov_i32" ? cursor.source() : ({ kind: "constant", value: cursor.word() } as const);
    return { kind: "move", destination, value };
  }
  const binaryOperator = binary.get(name);
  if (binaryOperator)
    return {
      kind: "binary",
      operator: binaryOperator,
      destination: cursor.destination(),
      left: cursor.operand(),
      right: cursor.operand(),
    };
  const unaryOperator = unary.get(name);
  if (unaryOperator)
    return {
      kind: "unary",
      operator: unaryOperator,
      destination: cursor.destination(),
      value: cursor.source(),
    };
  const pairOperator = pair.get(name);
  if (pairOperator) {
    const low = cursor.destination(),
      high = cursor.destination();
    if (low === high) throw new Error("TCI pair destinations overlap.");
    const left = pairOperator === "mul" ? wordPair(cursor) : cursor.pair();
    const right = pairOperator === "mul" ? wordPair(cursor) : cursor.pair();
    return { kind: "pair", operator: pairOperator, low, high, left, right };
  }
  if (name === "deposit_i32") return deposit(cursor);
  if (name === "setcond_i32" || name === "setcond2_i32") {
    const destination = cursor.destination(),
      wide = name === "setcond2_i32";
    const left = wide ? cursor.pair() : wordPair(cursor);
    const right = wide ? cursor.pair(true) : wordPair(cursor, true);
    return { kind: "compare", destination, left, right, wide, condition: cursor.comparison() };
  }
  return undefined;
}
