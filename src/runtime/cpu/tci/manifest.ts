import { TciLimit, type Comparison, type TciAbi } from "./model";
const MANIFEST_FIELDS = 2;
const MAX_CONSTANTS = 256;
const MAX_NAME_BYTES = 128;
const conditions = new Map<string, Comparison>([
  ["condition_EQ", "eq"],
  ["condition_NE", "ne"],
  ["condition_LT", "lt"],
  ["condition_GE", "ge"],
  ["condition_LE", "le"],
  ["condition_GT", "gt"],
  ["condition_LTU", "ltu"],
  ["condition_GEU", "geu"],
  ["condition_LEU", "leu"],
  ["condition_GTU", "gtu"],
]);
export function readTciAbi(memory: Uint8Array, address: number, count: number): TciAbi {
  const stride = MANIFEST_FIELDS * TciLimit.WordBytes;
  if (
    !Number.isSafeInteger(address) ||
    address < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_CONSTANTS ||
    address + count * stride > memory.length
  )
    throw new RangeError("Invalid TCI constant manifest.");
  const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  const constants = new Map<string, number>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    const slot = address + index * stride;
    const nameStart = view.getUint32(slot, true);
    const nameEnd = memory.indexOf(0, nameStart);
    if (nameEnd < nameStart || nameEnd - nameStart > MAX_NAME_BYTES)
      throw new RangeError("Invalid TCI constant name.");
    const name = decoder.decode(memory.subarray(nameStart, nameEnd));
    if (!/^[a-zA-Z0-9_]+$/.test(name) || constants.has(name))
      throw new Error("Invalid TCI constant name.");
    constants.set(name, view.getUint32(slot + TciLimit.WordBytes, true));
  }
  for (const [name, expected] of [
    ["register_count", TciLimit.Registers],
    ["environment_register", TciLimit.Environment],
    ["stack_register", TciLimit.Stack],
    ["constant_operand", TciLimit.ConstantOperand],
  ] as const) {
    if (constants.get(name) !== expected) throw new Error("Unsupported TCI register layout.");
    constants.delete(name);
  }
  const comparisons = new Map<number, Comparison>();
  for (const [name, condition] of conditions) {
    const value = constants.get(name);
    if (value === undefined || comparisons.has(value))
      throw new Error("Invalid TCI comparison manifest.");
    comparisons.set(value, condition);
    constants.delete(name);
  }
  const opcodes = new Map<number, string>();
  for (const [name, value] of constants) {
    if (value >= MAX_CONSTANTS || opcodes.has(value))
      throw new Error("Invalid TCI opcode manifest.");
    opcodes.set(value, name);
  }
  return { opcodes, comparisons };
}
