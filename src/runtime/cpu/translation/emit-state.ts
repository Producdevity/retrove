import { ExitKind, ReloadIndex, SpillIndex, Word } from "./emit-constants";
import type { Emitter, FlagLocals } from "./emitter";
import { StopState } from "./layout";
import { Op } from "./wasm-opcodes";

const flagOrder = (flags: FlagLocals) => [flags.n, flags.z, flags.c, flags.v];

const stateLocals = (e: Emitter) => [
  ...e.registers,
  ...flagOrder(e.flags),
  ...flagOrder(e.fpFlags),
];

/** Loads the cached guest registers, flags and used VFP lanes from the state block. */
export function loadAll(e: Emitter): void {
  const { c, L } = e;
  c.call(ReloadIndex);
  for (const local of stateLocals(e).reverse()) c.set(local);
  for (const [lane, local] of e.lanes)
    c.i32(L.vfp + Word.Bytes * lane)
      .memory(Op.I32Load)
      .set(local);
}

/** Stores the cached guest state back; translated calls and exits observe memory, not locals. */
export function storeAll(e: Emitter): void {
  const { c, L } = e;
  for (const local of stateLocals(e)) c.get(local);
  c.call(SpillIndex);
  for (const [lane, local] of e.lanes)
    c.i32(L.vfp + Word.Bytes * lane)
      .get(local)
      .memory(Op.I32Store);
}

/** Leaves through the shared epilogue, which stores the registers once. */
function leave(e: Emitter, kind: number, target: () => void): void {
  target();
  e.c.set(e.exitPC).i32(kind).set(e.exitKind).br("exit");
}

/** Returns the guest PC pushed by `target` to the caller. */
export const exit = (e: Emitter, target: () => void): void => leave(e, ExitKind.Return, target);
/** Continues at `target` outside this function, as a guest tail jump. */
export const tail = (e: Emitter, target: () => void): void => leave(e, ExitKind.Tail, target);
export const fail = (e: Emitter, target: () => void): void => leave(e, ExitKind.Fail, target);

/** Leaves at loop heads and function entries once the scheduler's slice is used up. */
export function emitBudget(e: Emitter, pc: number): void {
  const { c, L } = e,
    [counter] = e.t;
  c.i32(L.budget).i32(L.budget).memory(Op.I32Load).i32(1).op(Op.I32Sub).tee(counter);
  c.memory(Op.I32Store);
  c.get(counter).i32(0).op(Op.I32LtS).open(Op.If, "budget");
  c.i32(L.stopped).i32(StopState.Budget).memory(Op.I32Store);
  exit(e, () => c.i32(pc));
  c.end();
}

/** Counts visits to the stop PC and leaves on the last one. */
export function emitStop(e: Emitter): void {
  const { c, L } = e,
    stop = e.input.stopPC,
    [counter] = e.t;
  c.i32(L.stopCount).i32(L.stopCount).memory(Op.I32Load).i32(1).op(Op.I32Sub).tee(counter);
  c.memory(Op.I32Store);
  c.get(counter).op(Op.I32Eqz).open(Op.If, "stop");
  c.i32(L.stopped).i32(StopState.Stopped).memory(Op.I32Store);
  exit(e, () => c.i32(stop));
  c.end();
}

/** Leaves to the interpreter before `pc`; inside an IT block the whole block is retranslated to leave earlier. */
export function emitUnsupported(e: Emitter, pc: number): void {
  if (e.itStart !== undefined) e.itExits.add(e.itStart);
  e.unsupported++;
  e.unsupportedLeaders.push(pc);
  fail(e, () => e.c.i32(e.mode(pc)));
}
