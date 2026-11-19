import { guest, host, hostAt, reg } from "./emit-access";
import { Word } from "./emit-constants";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import {
  AccessBytes,
  ExclusiveBytes,
  Register,
  type ExclusiveSize,
  type InstructionOf,
  type TransferSize,
} from "./instruction";
import { stateOffset } from "./layout";
import { Atomic, Op, Type } from "./wasm-opcodes";

type Exclusive = InstructionOf<"exclusive">;
const HighWord = 32n;
const Plain: Record<TransferSize, { readonly load: number; readonly store: number }> = {
  [AccessBytes.Byte]: { load: Op.I32Load8U, store: Op.I32Store8 },
  [AccessBytes.Half]: { load: Op.I32Load16U, store: Op.I32Store16 },
  [AccessBytes.Word]: { load: Op.I32Load, store: Op.I32Store },
};
/** Atomic forms with their log2 alignment, which Wasm requires to equal the access size. */
const AtomicForms: Record<ExclusiveSize, { load: number; exchange: number; alignment: number }> = {
  [ExclusiveBytes.Byte]: { load: Atomic.I32Load8U, exchange: Atomic.I32Cmpxchg8U, alignment: 0 },
  [ExclusiveBytes.Half]: { load: Atomic.I32Load16U, exchange: Atomic.I32Cmpxchg16U, alignment: 1 },
  [ExclusiveBytes.Word]: { load: Atomic.I32Load, exchange: Atomic.I32Cmpxchg, alignment: 2 },
  [ExclusiveBytes.Double]: { load: Atomic.I64Load, exchange: Atomic.I64Cmpxchg, alignment: 3 },
};

/** LDREXD/STREXD on unshared memory: two word accesses, like LDRD/STRD. */
function emitPlainDouble(e: Emitter, pc: number, i: Exclusive): void {
  const { c } = e,
    [address, , first] = e.t;
  reg(e, i.rn, pc);
  c.set(address);
  if (i.load) {
    hostAt(e, address, 0);
    guest(e, Op.I32Load);
    c.set(first);
    hostAt(e, address, Word.Bytes);
    guest(e, Op.I32Load);
    c.set(e.register(i.rt2));
    c.get(first).set(e.register(i.rt));
    return;
  }
  for (const [k, register] of [i.rt, i.rt2].entries()) {
    hostAt(e, address, Word.Bytes * k);
    reg(e, register, pc);
    guest(e, Op.I32Store);
  }
  c.i32(0).set(e.register(i.rd));
}

/** Single-core forms for unshared memory: plain accesses, and every store succeeds. */
function emitPlain(e: Emitter, pc: number, i: Exclusive): void {
  const { c } = e;
  if (i.size === ExclusiveBytes.Double) return emitPlainDouble(e, pc, i);
  reg(e, i.rn, pc);
  c.i32(i.offset).op(Op.I32Add);
  host(e);
  if (i.load) {
    guest(e, Plain[i.size].load);
    c.set(e.register(i.rt));
  } else {
    reg(e, i.rt, pc);
    guest(e, Plain[i.size].store);
    c.i32(0).set(e.register(i.rd));
  }
}

/** Host address of the exclusive access, left in `address`. */
function exclusiveHost(e: Emitter, pc: number, i: Exclusive, address: number): void {
  reg(e, i.rn, pc);
  if (i.offset) e.c.i32(i.offset).op(Op.I32Add);
  host(e);
  e.c.set(address);
}

/** LDREX: an atomic load whose address and value arm this thread's monitor. */
function emitLoad(e: Emitter, pc: number, i: Exclusive): void {
  const { c, L } = e,
    [address, , value] = e.t,
    [wide] = e.x;
  const double = i.size === ExclusiveBytes.Double,
    loaded = double ? wide : value;
  exclusiveHost(e, pc, i, address);
  c.get(address).atomic(AtomicForms[i.size].load, AtomicForms[i.size].alignment).set(loaded);
  c.state().get(address).memory(Op.I32Store, stateOffset(L, L.exclusiveAddress));
  c.state()
    .get(loaded)
    .memory(double ? Op.I64Store : Op.I32Store, stateOffset(L, L.exclusiveValue));
  if (!double) {
    c.get(value).set(e.register(i.rt));
    return;
  }
  c.get(wide).op(Op.I32WrapI64).set(e.register(i.rt));
  c.get(wide).i64(HighWord).op(Op.I64ShrU).op(Op.I32WrapI64).set(e.register(i.rt2));
}

/**
 * STREX: compares and swaps against the value LDREX read when the monitor holds this address;
 * Rd is 0 on success and 1 otherwise, and the monitor is cleared either way.
 */
function emitStore(e: Emitter, pc: number, i: Exclusive): void {
  const { c, L } = e,
    [address, , status] = e.t;
  const double = i.size === ExclusiveBytes.Double,
    expected = () =>
      c.state().memory(double ? Op.I64Load : Op.I32Load, stateOffset(L, L.exclusiveValue));
  exclusiveHost(e, pc, i, address);
  c.state().memory(Op.I32Load, stateOffset(L, L.exclusiveAddress)).get(address).op(Op.I32Eq);
  c.open(Op.If, "strex", Type.I32);
  c.get(address);
  expected();
  reg(e, i.rt, pc);
  if (double) {
    c.op(Op.I64ExtendI32U);
    reg(e, i.rt2, pc);
    c.op(Op.I64ExtendI32U).i64(HighWord).op(Op.I64Shl).op(Op.I64Or);
  }
  c.atomic(AtomicForms[i.size].exchange, AtomicForms[i.size].alignment);
  expected();
  c.op(double ? Op.I64Ne : Op.I32Ne)
    .else()
    .i32(1)
    .end()
    .set(status);
  c.state().i32(0).memory(Op.I32Store, stateOffset(L, L.exclusiveAddress));
  c.get(status).set(e.register(i.rd));
}

export function emitExclusive(e: Emitter, pc: number, i: Exclusive): void {
  const registers = [i.rt, i.rn, i.rd, ...(i.size === ExclusiveBytes.Double ? [i.rt2] : [])];
  if (registers.includes(Register.PC)) return emitUnsupported(e, pc);
  if (!e.input.shared) return emitPlain(e, pc, i);
  if (i.load) emitLoad(e, pc, i);
  else emitStore(e, pc, i);
}

/** CLREX clears the monitor and barriers fence; on unshared memory both stay the no-op they were. */
export function emitSync(e: Emitter, i: InstructionOf<"sync">): void {
  const { c, L } = e;
  if (i.clear) c.state().i32(0).memory(Op.I32Store, stateOffset(L, L.exclusiveAddress));
  else c.fence();
}
