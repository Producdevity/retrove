import { TciLimit, type MemoryWidth, type TciInstruction } from "../model";
import { FunctionIndex, HELPER_ARGUMENTS, Local, Op, Signature } from "./abi";
import type { Emitter } from "./emitter";
const LOAD: Readonly<Record<MemoryWidth, readonly [number, number]>> = {
  byte: [Op.LoadByte, Op.LoadByteSigned],
  half: [Op.LoadHalf, Op.LoadHalfSigned],
  word: [Op.Load, Op.Load],
};
const STORE: Readonly<Record<MemoryWidth, number>> = {
  byte: Op.StoreByte,
  half: Op.StoreHalf,
  word: Op.Store,
};

export function memory(code: Emitter, instruction: TciInstruction, pc: number): boolean {
  const operation = instruction.operation;
  switch (operation.kind) {
    case "host-load":
      code.operand(operation.base).integer(operation.offset).add(Op.Add);
      code
        .memory(LOAD[operation.width][operation.signed ? 1 : 0])
        .destination(operation.destination);
      break;
    case "host-store":
      code.operand(operation.base).integer(operation.offset).add(Op.Add).operand(operation.value);
      code.memory(STORE[operation.width]);
      break;
    case "call":
      code.programCounter(pc, instruction.address);
      for (const register of HELPER_ARGUMENTS) code.get(Local.FirstRegister + register);
      code.operand(operation.target).add(Op.CallIndirect).unsigned(Signature.Helper).unsigned(0);
      code.wideResult(0, 1);
      break;
    case "guest-load": {
      const low = operation.destinations[0];
      if (low === undefined) throw new Error("TCI load has no destination.");
      code.programCounter(pc, instruction.address);
      code.get(Local.FirstRegister + TciLimit.Environment).operand(operation.address);
      code
        .integer(operation.mode)
        .integer(instruction.next)
        .add(Op.Call)
        .unsigned(FunctionIndex.Load);
      code.wideResult(low, operation.destinations[1]);
      break;
    }
    case "guest-store":
      code.programCounter(pc, instruction.address);
      code
        .get(Local.FirstRegister + TciLimit.Environment)
        .operand(operation.address)
        .pair(operation.value);
      code
        .integer(operation.mode)
        .integer(instruction.next)
        .add(Op.Call)
        .unsigned(FunctionIndex.Store);
      break;
    case "barrier":
      break;
    default:
      return false;
  }
  return true;
}
