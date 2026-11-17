import { condition, reg } from "./emit-access";
import { emitData } from "./emit-alu";
import { Lanes, Word } from "./emit-constants";
import { branchTo, callTo, jumpTo } from "./emit-control";
import {
  emitBitfield,
  emitClz,
  emitDivide,
  emitExtend,
  emitExtract,
  emitLongMultiply,
  emitMultiply,
  emitMultiplyHalf,
  emitMultiplyHigh,
  emitReverse,
} from "./emit-integer";
import { emitExclusive, emitMemory, emitMultiple, emitPair, emitTable } from "./emit-memory";
import { emitUnsupported } from "./emit-state";
import { emitVector } from "./emit-vector";
import type { Emitter } from "./emitter";
import { Condition, Register, type Instruction } from "./instruction";
import { lanesOf } from "./lanes";
import { Op } from "./wasm-opcodes";

const DestinationKinds = new Set<string>([
  "div",
  "extend",
  "bitfield",
  "extract",
  "movw",
  "movt",
  "clz",
]);
const VectorPrefix = "v";
const HalfShift = 16;

/** Emits one reachable instruction, wrapped in its condition. */
export function emitInstruction(e: Emitter, pc: number, i: Instruction, current: number): void {
  const { c } = e;
  e.debugPC = pc;
  const conditional = i.cond < Condition.Always;
  if (
    (i.cond === Condition.Unconditional && !i.kind.startsWith(VectorPrefix)) ||
    lanesOf(i).some((lane) => lane >= Lanes.Architectural)
  ) {
    emitUnsupported(e, pc);
    return;
  }
  if (conditional) {
    condition(e, i.cond);
    c.open(Op.If, "if");
  }
  emitBody(e, pc, i, current);
  if (conditional) c.end();
}

function writesPC(i: Instruction): boolean {
  return DestinationKinds.has(i.kind) && "rd" in i && i.rd === Register.PC;
}

function emitBody(e: Emitter, pc: number, i: Instruction, current: number): void {
  const { c } = e;
  if (writesPC(i)) return emitUnsupported(e, pc);
  switch (i.kind) {
    case "data":
      return emitData(e, pc, i);
    case "mul":
      return emitMultiply(e, pc, i);
    case "div":
      return emitDivide(e, pc, i);
    case "extend":
      return emitExtend(e, pc, i);
    case "mulhalf":
      return emitMultiplyHalf(e, pc, i);
    case "mulhigh":
      return emitMultiplyHigh(e, pc, i);
    case "bitfield":
      return emitBitfield(e, pc, i);
    case "extract":
      return emitExtract(e, pc, i);
    case "movw":
      c.i32(i.value).set(e.register(i.rd));
      return;
    case "movt":
      c.get(e.register(i.rd))
        .i32(Word.Half)
        .op(Op.I32And)
        .i32(i.value << HalfShift);
      c.op(Op.I32Or).set(e.register(i.rd));
      return;
    case "clz":
      return emitClz(e, pc, i);
    case "tls":
      c.i32(e.L.tls).memory(Op.I32Load).set(e.register(i.rd));
      return;
    case "mem":
      return emitMemory(e, pc, i);
    case "cbz":
      c.get(e.register(i.rn));
      if (!i.nonzero) c.op(Op.I32Eqz);
      c.open(Op.If, "cbz");
      branchTo(e, i.target, current);
      c.end();
      return;
    default:
      return emitControl(e, pc, i, current);
  }
}

function emitControl(e: Emitter, pc: number, i: Instruction, current: number): void {
  const { c } = e;
  switch (i.kind) {
    case "reverse":
      return emitReverse(e, pc, i);
    case "table":
      return emitTable(e, pc, i);
    case "exclusive":
      return emitExclusive(e, pc, i);
    case "mull":
      return emitLongMultiply(e, pc, i);
    case "pair":
      return emitPair(e, pc, i);
    case "multiple":
      return emitMultiple(e, pc, i);
    case "branch":
      if (i.link) return callTo(e, pc, i.target);
      return branchTo(e, i.target, current);
    case "bx": {
      const [, , target] = e.t;
      reg(e, i.rm, pc);
      c.set(target);
      if (i.link) return callTo(e, pc, () => c.get(target));
      return jumpTo(e, target, i.rm === Register.LR ? "return" : "indirect");
    }
    default:
      return emitVector(e, pc, i);
  }
}
