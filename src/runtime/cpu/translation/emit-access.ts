import { Word } from "./emit-constants";
import type { Emitter } from "./emitter";
import { Register } from "./instruction";
import { Op } from "./wasm-opcodes";

const LogEntry = { PreviousWord: 4, PC: 8, Bytes: 12 } as const;
const Conditions = {
  Equal: 0,
  CarrySet: 1,
  Negative: 2,
  Overflow: 3,
  Higher: 4,
  GreaterEqual: 5,
  Greater: 6,
} as const;
const LoggedStores = new Set<number>([Op.I32Store, Op.I32Store16, Op.I32Store8]);

/** Pushes guest register `n`; PC reads as the instruction address plus the pipeline offset. */
export function reg(e: Emitter, n: number, pc: number): void {
  if (n === Register.PC) e.c.i32(e.pcValue(pc));
  else e.c.get(e.register(n));
}

/** Masks the guest address on the stack into the arena's span; accesses then add the arena base (see `guest`). */
export function host(e: Emitter): void {
  const { c, L } = e,
    address = e.hostTemp,
    [, , , , , , , debug] = e.t;
  if (e.input.debug) {
    c.tee(address).set(debug);
    c.i32(L.debugAddress).get(debug).memory(Op.I32Store);
    c.i32(L.debugPC).i32(e.mode(e.debugPC)).memory(Op.I32Store).get(debug);
  }
  c.i32(L.mask).op(Op.I32And);
}

/** Host address of guest word `start + offset`; each word is translated on its own since transfers may cross pages. */
export function hostAt(e: Emitter, start: number, offset: number): void {
  e.c.get(start);
  if (offset) e.c.i32(offset).op(Op.I32Add);
  host(e);
}

/** Memory access at the host address on the stack; debug builds log each store's previous word. */
export function guest(e: Emitter, opcode: number, offset = 0): void {
  const { c, L, log } = e;
  if (log && LoggedStores.has(opcode)) {
    c.set(log.value).set(log.host);
    c.i32(L.logCursor).memory(Op.I32Load).tee(log.at).i32(L.logLimit).memory(Op.I32Load);
    c.op(Op.I32LtU).open(Op.If, "log");
    c.get(log.at)
      .get(log.host)
      .i32(L.arena + offset)
      .op(Op.I32Add)
      .memory(Op.I32Store);
    c.get(log.at)
      .get(log.host)
      .memory(Op.I32Load, L.arena + offset);
    c.memory(Op.I32Store, LogEntry.PreviousWord);
    c.get(log.at).i32(e.mode(e.debugPC)).memory(Op.I32Store, LogEntry.PC);
    c.i32(L.logCursor).get(log.at).i32(LogEntry.Bytes).op(Op.I32Add).memory(Op.I32Store);
    c.end();
    c.get(log.host).get(log.value);
  }
  c.memory(opcode, L.arena + offset);
}

/** Pushes whether ARM condition `cond` (0-13) holds. */
export function condition(e: Emitter, cond: number): void {
  const { c } = e,
    { n, z, c: cf, v } = e.flags;
  switch (cond >> 1) {
    case Conditions.Equal:
      c.get(z);
      break;
    case Conditions.CarrySet:
      c.get(cf);
      break;
    case Conditions.Negative:
      c.get(n);
      break;
    case Conditions.Overflow:
      c.get(v);
      break;
    case Conditions.Higher:
      c.get(cf).get(z).op(Op.I32Eqz).op(Op.I32And);
      break;
    case Conditions.GreaterEqual:
      c.get(n).get(v).op(Op.I32Eq);
      break;
    case Conditions.Greater:
      c.get(z).op(Op.I32Eqz).get(n).get(v).op(Op.I32Eq).op(Op.I32And);
      break;
    default:
      throw new Error("Unconditional condition");
  }
  if (cond & 1) c.op(Op.I32Eqz);
}

export function setNZ(e: Emitter, value: number): void {
  const { n, z } = e.flags;
  e.c.get(value).i32(Word.SignShift).op(Op.I32ShrU).set(n).get(value).op(Op.I32Eqz).set(z);
}
