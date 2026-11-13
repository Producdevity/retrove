import { TciCursor } from "./cursor";
import { decodeArithmetic, wordPair } from "./decode-arithmetic";
import { decodeMemory } from "./decode-memory";
import {
  TciLimit,
  UnsupportedTciOperation,
  type Operation,
  type TciAbi,
  type TciBlock,
  type TciInstruction,
} from "./model";
const INSTRUCTION_HEADER_BYTES = 2;
const ADDRESS_SPACE_BYTES = 0x1_0000_0000;
function decodeFlow(name: string, cursor: TciCursor): Operation | undefined {
  switch (name) {
    case "call":
      return { kind: "call", target: cursor.operand() };
    case "br":
      return { kind: "branch", target: cursor.word() };
    case "brcond_i32":
    case "brcond2_i32": {
      const wide = name === "brcond2_i32";
      const left = wide ? cursor.pair() : wordPair(cursor);
      const right = wide ? cursor.pair(true) : wordPair(cursor, true);
      const condition = cursor.comparison();
      return { kind: "conditional", wide, left, right, condition, target: cursor.word() };
    }
    case "mb":
      return { kind: "barrier" };
    case "goto_tb": {
      const cell =
        Math.ceil((cursor.address + cursor.offset) / TciLimit.WordBytes) * TciLimit.WordBytes;
      cursor.offset = cell - cursor.address;
      cursor.word();
      return { kind: "jump", cell };
    }
    case "exit_tb": {
      const value = cursor.word();
      cursor.word();
      return { kind: "exit", value };
    }
  }
  return undefined;
}
export function decodeTci(bytes: Uint8Array, address: number, abi: TciAbi): TciBlock {
  if (
    !Number.isSafeInteger(address) ||
    address < 0 ||
    !bytes.length ||
    bytes.length > TciLimit.BlockBytes ||
    address + bytes.length > ADDRESS_SPACE_BYTES
  )
    throw new RangeError("Invalid TCI code range.");
  const cursor = new TciCursor(bytes, address, abi),
    instructions: TciInstruction[] = [];
  while (cursor.offset < bytes.length) {
    if (instructions.length === TciLimit.Instructions)
      throw new UnsupportedTciOperation("TCI block exceeds the instruction limit.");
    const offset = cursor.offset;
    cursor.limit = bytes.length;
    const opcode = cursor.byte(),
      size = cursor.byte(),
      name = abi.opcodes.get(opcode);
    if (size < INSTRUCTION_HEADER_BYTES || offset + size > bytes.length)
      throw new RangeError("Invalid TCI instruction length.");
    cursor.limit = offset + size;
    if (!name) throw new UnsupportedTciOperation(`Unknown TCI opcode ${opcode}.`);
    const operation =
      decodeArithmetic(name, cursor) ?? decodeMemory(name, cursor) ?? decodeFlow(name, cursor);
    if (!operation) throw new UnsupportedTciOperation(`Unsupported TCI operation ${name}.`);
    if (cursor.offset !== cursor.limit)
      throw new RangeError(`Incorrect TCI operand length for ${name}.`);
    instructions.push({ address: address + offset, next: address + cursor.offset, operation });
  }
  const boundaries = new Set(instructions.map((instruction) => instruction.address));
  for (const { operation } of instructions)
    if (
      (operation.kind === "branch" || operation.kind === "conditional") &&
      !boundaries.has(operation.target)
    )
      throw new Error("TCI branch target is not an instruction boundary.");
  return { address, instructions };
}
