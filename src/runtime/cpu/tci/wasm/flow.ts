import { TciLimit, UnsupportedTciOperation, type TciBlock, type TciInstruction } from "../model";
import { Local, Op, Wasm } from "./abi";
import { arithmetic, comparison } from "./arithmetic";
import { Emitter } from "./emitter";
import { memory } from "./memory";

interface Region {
  readonly address: number;
  readonly instructions: TciInstruction[];
}
function regions(block: TciBlock): Region[] {
  const starts = new Set([block.address]);
  for (const { next, operation } of block.instructions) {
    if (operation.kind === "branch" || operation.kind === "conditional")
      starts.add(operation.target);
    if (["branch", "conditional", "jump", "exit"].includes(operation.kind)) starts.add(next);
  }
  const result: Region[] = [];
  let current: Region | undefined;
  for (const instruction of block.instructions) {
    if (starts.has(instruction.address)) {
      current = { address: instruction.address, instructions: [] };
      result.push(current);
    }
    if (!current) throw new Error("TCI region does not start at the block entry.");
    current.instructions.push(instruction);
  }
  if (!result.length || result.length > TciLimit.BasicBlocks)
    throw new UnsupportedTciOperation("TCI block exceeds the control-flow limit.");
  return result;
}
function branch(
  code: Emitter,
  labels: ReadonlyMap<number, number>,
  target: number,
  depth: number,
): void {
  const label = labels.get(target);
  if (label === undefined) throw new Error("TCI branch has no destination region.");
  code.integer(label).set(Local.Label).add(Op.Branch).unsigned(depth);
}
function flow(
  code: Emitter,
  instruction: TciInstruction,
  labels: ReadonlyMap<number, number>,
  depth: number,
): void {
  const operation = instruction.operation;
  switch (operation.kind) {
    case "branch":
      branch(code, labels, operation.target, depth);
      break;
    case "conditional":
      comparison(code, operation.left, operation.right, operation.condition, operation.wide);
      code.add(Op.If, Wasm.Empty);
      branch(code, labels, operation.target, depth + 1);
      code.add(Op.End);
      break;
    case "jump":
      code.registers("store");
      code.get(Local.Next).integer(operation.cell + TciLimit.WordBytes);
      code.integer(operation.cell).memory(Op.Load).add(Op.Add).memory(Op.Store);
      code.integer(0).add(Op.Return);
      break;
    case "exit":
      code.registers("store");
      code.get(Local.Result).integer(operation.value).memory(Op.Store);
      code.integer(1).add(Op.Return);
      break;
    default:
      throw new UnsupportedTciOperation(`Cannot compile TCI operation ${operation.kind}.`);
  }
}
export function functionBody(block: TciBlock, pc: number): Uint8Array<ArrayBuffer> {
  const parts = regions(block);
  const labels = new Map(parts.map((part, index) => [part.address, index]));
  const LOCAL_GROUPS = 2;
  const code = new Emitter()
    .unsigned(LOCAL_GROUPS)
    .unsigned(TciLimit.Registers + 1)
    .add(Wasm.I32, 1, Wasm.I64);
  code.registers("load");
  code.add(Op.Block, Wasm.Empty, Op.Loop, Wasm.Empty);
  for (const _part of parts) code.add(Op.Block, Wasm.Empty);
  code.get(Local.Label).add(Op.BranchTable).unsigned(parts.length);
  for (const [index] of parts.entries()) code.unsigned(index);
  code.unsigned(parts.length + 1);
  for (const [index, part] of parts.entries()) {
    code.add(Op.End);
    for (const instruction of part.instructions) {
      if (arithmetic(code, instruction.operation) || memory(code, instruction, pc)) continue;
      flow(code, instruction, labels, parts.length - index - 1);
    }
  }
  return code.add(Op.Unreachable, Op.End, Op.End, Op.Unreachable, Op.End).finish();
}
