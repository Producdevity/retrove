import { blockLabel, inMode, inRange, labelAt } from "./emit-control";
import { DispatchIndex, ExitKind, Lanes } from "./emit-constants";
import { emitInstruction } from "./emit-instruction";
import { nestedCall } from "./emit-depth";
import { emitBudget, emitStop, fail, loadAll, storeAll, tail } from "./emit-state";
import { EntryParameter, type Emitter } from "./emitter";
import { discover } from "./discover";
import { lanesOf } from "./lanes";
import { relative, StopState } from "./layout";
import type { Code } from "./wasm-code";
import { BlockType, Op, Type } from "./wasm-opcodes";

export interface EmittedFunction {
  readonly code: Code;
  readonly labels: Int32Array;
  readonly blocks: number;
  readonly reachable: number;
  readonly unsupported: number;
  readonly unsupportedLeaders: number[];
}

const NoLabel = -1;

/** Reserves a local for each architectural lane the reachable code touches. */
function reserveLanes(e: Emitter, reachable: Set<number>): void {
  for (const { address, instruction } of e.decoded)
    if (reachable.has(address))
      for (const lane of lanesOf(instruction))
        if (lane < Lanes.Architectural && !e.lanes.has(lane))
          e.lanes.set(lane, e.c.local(Type.I32));
}

/** Looks up the entry PC's label; entries without one record the PC and leave. */
function emitEntry(e: Emitter): void {
  const { c } = e,
    [offset] = e.t;
  c.get(EntryParameter);
  inRange(e, offset);
  inMode(e, EntryParameter);
  c.op(Op.I32And).op(Op.If, Type.I32);
  labelAt(e, offset);
  c.op(Op.Else).i32(NoLabel).op(Op.End);
  c.tee(e.label).i32(0).op(Op.I32LtS).open(Op.If, "entry");
  c.arena().get(EntryParameter).memory(Op.I32Store, relative(e.L, e.L.missingLabel));
  fail(e, () => c.get(EntryParameter));
  c.end();
}

/** Shared epilogue: store state once, then tail-dispatch, record a failure or return the exit PC. */
function emitEpilogue(e: Emitter): void {
  const { c } = e;
  storeAll(e);
  c.get(e.exitKind).i32(ExitKind.Tail).op(Op.I32Eq).op(Op.If, BlockType.Empty);
  nestedCall(
    e,
    () => c.get(e.exitPC),
    () => c.call(DispatchIndex),
  );
  c.op(Op.Return).op(Op.End);
  c.get(e.exitKind).i32(ExitKind.Fail).op(Op.I32Eq).op(Op.If, BlockType.Empty);
  c.arena().i32(StopState.Exit).memory(Op.I32Store, relative(e.L, e.L.stopped));
  c.arena().get(e.exitPC).memory(Op.I32Store, relative(e.L, e.L.exitPC)).op(Op.End);
  c.get(e.exitPC);
}

/**
 * Emits the function as a loop over a `br_table` of basic blocks. Leaders are numbered in address order, so a
 * forward branch is a `br` out of nested blocks and a backward one re-enters the loop with a new label.
 */
export function emitFunction(e: Emitter): EmittedFunction {
  const { c } = e;
  const { leaders, reachable } = discover(e);
  leaders.forEach((address, index) => {
    e.leaders.set(address, index);
    e.labels[e.slot(address)] = index;
  });
  reserveLanes(e, reachable);
  loadAll(e);
  c.open(Op.Block, "exit");
  emitEntry(e);
  c.open(Op.Loop, "dispatch");
  for (let k = leaders.length - 1; k >= 0; k--) c.open(Op.Block, blockLabel(k));
  c.get(e.label).brTable(
    leaders.map((_, k) => blockLabel(k)),
    blockLabel(0),
  );
  let current = -1;
  for (const { address, instruction, size, itStart } of e.decoded) {
    const leader = e.leaders.get(address);
    if (leader !== undefined) {
      c.end();
      current = leader;
      if (address === e.local(e.input.stopPC)) emitStop(e);
      if (e.budgetPoints.has(address)) emitBudget(e, e.mode(address));
    }
    if (current < 0 || !reachable.has(address)) continue;
    e.size = size;
    e.itStart = itStart;
    emitInstruction(e, address, instruction, current);
  }
  tail(e, () => c.i32(e.mode(e.range.end)));
  c.end();
  c.end();
  emitEpilogue(e);
  return {
    code: c,
    labels: e.labels,
    blocks: leaders.length,
    reachable: reachable.size,
    unsupported: e.unsupported,
    unsupportedLeaders: e.unsupportedLeaders,
  };
}
