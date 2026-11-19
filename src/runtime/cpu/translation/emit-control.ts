import { ClearThumb, DispatchIndex, LabelSlotShift } from "./emit-constants";
import { nestedCall } from "./emit-depth";
import { exit, loadAll, storeAll, tail } from "./emit-state";
import { relative } from "./layout";
import type { Emitter } from "./emitter";
import { Register } from "./instruction";
import { BlockType, Op } from "./wasm-opcodes";

export const blockLabel = (leader: number): string => "B" + leader;

/** Pushes the in-function byte offset of the PC on the stack into `offset` and whether it has a label slot. */
export function inRange(e: Emitter, offset: number): void {
  e.c
    .i32(ClearThumb)
    .op(Op.I32And)
    .i32(e.base)
    .op(Op.I32Sub)
    .tee(offset)
    .i32(e.range.end - e.base)
    .op(Op.I32LtU);
}

/** Pushes whether the PC in local `pc` has this function's instruction-set bits. */
export function inMode(e: Emitter, pc: number): void {
  const { mask, value } = e.modeBits();
  e.c.get(pc).i32(mask).op(Op.I32And).i32(value).op(Op.I32Eq);
}

/** Pushes the label table entry for the byte offset in local `offset`. */
export function labelAt(e: Emitter, offset: number): void {
  e.c
    .get(offset)
    .i32(LabelSlotShift)
    .op(Op.I32Shl)
    .arena()
    .op(Op.I32Add)
    .memory(Op.I32Load, relative(e.L, e.labelAddress));
}

/** Jumps to a PC computed into local `target`; `kind` selects local dispatch or leaving the function. */
export function jumpTo(e: Emitter, target: number, kind: "return" | "indirect"): void {
  const { c } = e,
    [, , , , known, offset] = e.t;
  if (kind === "return") {
    exit(e, () => c.get(target));
    return;
  }
  inMode(e, target);
  c.get(target);
  inRange(e, offset);
  c.op(Op.I32And).open(Op.If, "local");
  labelAt(e, offset);
  c.tee(known).i32(0).op(Op.I32GeS).open(Op.If, "known");
  c.get(known).set(e.label).br("dispatch");
  c.end().end();
  tail(e, () => c.get(target));
}

export function branchTo(e: Emitter, target: number, current: number): void {
  const { c } = e,
    address = e.local(target),
    leader = address === undefined ? undefined : e.leaders.get(address);
  if (leader !== undefined) {
    if (leader > current) c.br(blockLabel(leader));
    else c.i32(leader).set(e.label).br("dispatch");
    return;
  }
  const index = e.functionIndex(target);
  if (index === undefined) {
    tail(e, () => c.i32(target));
    return;
  }
  storeAll(e);
  nestedCall(
    e,
    () => c.i32(target),
    () => c.call(index),
  );
  c.op(Op.Return);
}

/** Calls a translated function or the dispatcher, then continues here only if it returned to the link address. */
export function callTo(e: Emitter, pc: number, target: (() => void) | number): void {
  const { c } = e,
    ret = e.mode(pc + e.size),
    [, , , result] = e.t;
  c.i32(ret).set(e.register(Register.LR));
  storeAll(e);
  if (typeof target === "number") {
    const index = e.functionIndex(target) ?? DispatchIndex;
    nestedCall(
      e,
      () => c.i32(target),
      () => c.call(index),
    );
  } else nestedCall(e, target, () => c.call(DispatchIndex));
  c.tee(result).i32(ret).op(Op.I32Ne).arena().memory(Op.I32Load, relative(e.L, e.L.stopped));
  c.op(Op.I32Or);
  c.op(Op.If, BlockType.Empty).get(result).op(Op.Return).op(Op.End);
  loadAll(e);
}
