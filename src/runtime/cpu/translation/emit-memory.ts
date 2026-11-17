import { guest, host, hostAt, reg } from "./emit-access";
import { Word } from "./emit-constants";
import { jumpTo } from "./emit-control";
import { offset } from "./emit-shift";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { AccessBytes, Register, type InstructionOf } from "./instruction";
import { Op } from "./wasm-opcodes";

function loadOpcode(size: number, signed: boolean): number {
  if (size === AccessBytes.Word) return Op.I32Load;
  if (size === AccessBytes.Half) return signed ? Op.I32Load16S : Op.I32Load16U;
  return signed ? Op.I32Load8S : Op.I32Load8U;
}

function storeOpcode(size: number): number {
  if (size === AccessBytes.Word) return Op.I32Store;
  return size === AccessBytes.Half ? Op.I32Store16 : Op.I32Store8;
}

/** A word load from a code page at a constant address reads the literal at translation time. */
function emitLiteral(e: Emitter, pc: number, i: InstructionOf<"mem">): boolean {
  if (i.rn !== Register.PC || i.offset.kind !== "imm" || !i.load || i.size !== AccessBytes.Word)
    return false;
  if (i.writeback) return false;
  const { c } = e,
    [, , value] = e.t;
  const literal = e.literalBase(pc) + (i.add ? i.offset.value : -i.offset.value);
  const word = e.input.isCode(literal) ? e.input.readWord(literal) : undefined;
  if (word === undefined) return false;
  c.i32(word).set(value);
  if (i.rd === Register.PC) jumpTo(e, value, "indirect");
  else c.get(value).set(e.register(i.rd));
  return true;
}

export function emitMemory(e: Emitter, pc: number, i: InstructionOf<"mem">): void {
  const { c } = e,
    [address, base, value, , updated] = e.t;
  if (i.writeback && (i.rn === Register.PC || (i.load && i.rn === i.rd)))
    return emitUnsupported(e, pc);
  if (emitLiteral(e, pc, i)) return;
  if (i.rn === Register.PC) c.i32(e.literalBase(pc));
  else reg(e, i.rn, pc);
  c.set(base);
  c.get(base);
  offset(e, i.offset, pc);
  c.op(i.add ? Op.I32Add : Op.I32Sub).set(updated);
  c.get(i.pre ? updated : base).set(address);
  c.get(address);
  host(e);
  if (i.load) {
    guest(e, loadOpcode(i.size, i.signed));
    c.set(value);
    if (i.writeback) c.get(updated).set(e.register(i.rn));
    if (i.rd === Register.PC) return jumpTo(e, value, i.rn === Register.SP ? "return" : "indirect");
    c.get(value).set(e.register(i.rd));
  } else {
    reg(e, i.rd, pc);
    guest(e, storeOpcode(i.size));
    if (i.writeback) c.get(updated).set(e.register(i.rn));
  }
}

export function emitMultiple(e: Emitter, pc: number, i: InstructionOf<"multiple">): void {
  const { c } = e,
    [base, start, target] = e.t;
  if (i.rn === Register.PC) return emitUnsupported(e, pc);
  const count = i.registers.length,
    span = Word.Bytes * count;
  const first = i.increment ? (i.before ? Word.Bytes : 0) : i.before ? -span : -span + Word.Bytes;
  reg(e, i.rn, pc);
  c.tee(base).i32(first).op(Op.I32Add).set(start);
  i.registers.forEach((register, k) => {
    hostAt(e, start, Word.Bytes * k);
    if (i.load) {
      guest(e, Op.I32Load);
      c.set(register === Register.PC ? target : e.register(register));
    } else {
      reg(e, register, pc);
      guest(e, Op.I32Store);
    }
  });
  if (i.writeback && !(i.load && i.registers.includes(i.rn)))
    c.get(base)
      .i32(i.increment ? span : -span)
      .op(Op.I32Add)
      .set(e.register(i.rn));
  if (i.load && i.registers.includes(Register.PC))
    jumpTo(e, target, i.rn === Register.SP ? "return" : "indirect");
}

export function emitPair(e: Emitter, pc: number, i: InstructionOf<"pair">): void {
  const { c } = e,
    [base, updated, address, second] = e.t;
  if (
    i.rn === Register.PC ||
    i.rt === Register.PC ||
    i.rt2 === Register.PC ||
    i.rt === i.rt2 ||
    (i.writeback && (i.rn === i.rt || i.rn === i.rt2))
  )
    return emitUnsupported(e, pc);
  reg(e, i.rn, pc);
  c.tee(base);
  offset(e, i.offset, pc);
  c.op(i.add ? Op.I32Add : Op.I32Sub).set(updated);
  c.get(i.pre ? updated : base).set(address);
  if (i.load) {
    hostAt(e, address, Word.Bytes);
    guest(e, Op.I32Load);
    c.set(second);
    hostAt(e, address, 0);
    guest(e, Op.I32Load);
    c.set(e.register(i.rt));
    c.get(second).set(e.register(i.rt2));
  } else {
    hostAt(e, address, 0);
    reg(e, i.rt, pc);
    guest(e, Op.I32Store);
    hostAt(e, address, Word.Bytes);
    reg(e, i.rt2, pc);
    guest(e, Op.I32Store);
  }
  if (i.writeback) c.get(updated).set(e.register(i.rn));
}

/** LDREX/STREX on a single core: the store always succeeds. */
export function emitExclusive(e: Emitter, pc: number, i: InstructionOf<"exclusive">): void {
  const { c } = e;
  if (i.rt === Register.PC || i.rn === Register.PC || i.rd === Register.PC)
    return emitUnsupported(e, pc);
  reg(e, i.rn, pc);
  c.i32(i.offset).op(Op.I32Add);
  host(e);
  if (i.load) {
    guest(e, Op.I32Load);
    c.set(e.register(i.rt));
  } else {
    reg(e, i.rt, pc);
    guest(e, Op.I32Store);
    c.i32(0).set(e.register(i.rd));
  }
}

/** TBB/TBH: loads the halfword count and dispatches to the target. */
export function emitTable(e: Emitter, pc: number, i: InstructionOf<"table">): void {
  const { c } = e,
    [, , target] = e.t;
  reg(e, i.rn, pc);
  reg(e, i.rm, pc);
  if (i.half) c.i32(1).op(Op.I32Shl);
  c.op(Op.I32Add);
  host(e);
  guest(e, i.half ? Op.I32Load16U : Op.I32Load8U);
  c.i32(1)
    .op(Op.I32Shl)
    .i32(i.base | 1)
    .op(Op.I32Add)
    .set(target);
  jumpTo(e, target, "indirect");
}
