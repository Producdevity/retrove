import { ClearThumb, ForeignProbes, FunctionType, LabelSlotShift } from "./emit-constants";
import { EntryParameter } from "./emitter";
import { PageBits, relative, StopState, type StateLayout } from "./layout";
import { Code } from "./wasm-code";
import { BlockType, Op, Type } from "./wasm-opcodes";

const Foreign = { ArmAlignment: 3, SlotShift: 3, TargetOffset: 4 } as const;

/** Probes the open-addressed foreign code table for word-aligned (ARM) PCs outside the executable. */
function emitForeign(c: Code, L: StateLayout, foreign: NonNullable<StateLayout["foreign"]>): void {
  const page = c.local(Type.I32),
    slot = c.local(Type.I32);
  c.get(EntryParameter).i32(Foreign.ArmAlignment).op(Op.I32And).op(Op.I32Eqz);
  c.op(Op.If, BlockType.Empty);
  c.get(EntryParameter).i32(PageBits).op(Op.I32ShrU).i32(1).op(Op.I32Add).set(page);
  for (let probe = 0; probe < ForeignProbes; probe++) {
    c.get(page)
      .i32(probe)
      .op(Op.I32Add)
      .i32(foreign.slots - 1)
      .op(Op.I32And);
    c.i32(Foreign.SlotShift).op(Op.I32Shl).set(slot);
    c.get(slot).arena().op(Op.I32Add).memory(Op.I32Load, relative(L, foreign.base));
    c.get(page).op(Op.I32Eq).op(Op.If, BlockType.Empty);
    c.get(EntryParameter)
      .get(slot)
      .arena()
      .op(Op.I32Add)
      .memory(Op.I32Load, relative(L, foreign.base) + Foreign.TargetOffset);
    c.i32(1).op(Op.I32Sub).callIndirect(FunctionType).op(Op.Return).op(Op.End);
  }
  c.op(Op.End);
}

/** Continues at a guest PC through the shared address index; leaves to the interpreter when nothing is translated there. */
export function emitDispatch(L: StateLayout): Code {
  const c = new Code(1);
  const entry = c.local(Type.I32);
  c.get(EntryParameter).i32(ClearThumb).op(Op.I32And).i32(L.index.start).op(Op.I32Sub).tee(entry);
  c.i32(L.index.end - L.index.start)
    .op(Op.I32LtU)
    .op(Op.If, BlockType.Empty);
  c.get(entry).i32(LabelSlotShift).op(Op.I32Shl).arena().op(Op.I32Add);
  c.memory(Op.I32Load, relative(L, L.index.base)).tee(entry);
  c.op(Op.If, BlockType.Empty).get(EntryParameter).get(entry).i32(1).op(Op.I32Sub);
  c.callIndirect(FunctionType).op(Op.Return).op(Op.End);
  c.op(Op.End);
  if (L.foreign) emitForeign(c, L, L.foreign);
  c.arena().i32(StopState.Exit).memory(Op.I32Store, relative(L, L.stopped));
  c.arena().get(EntryParameter).memory(Op.I32Store, relative(L, L.exitPC)).get(EntryParameter);
  return c;
}
