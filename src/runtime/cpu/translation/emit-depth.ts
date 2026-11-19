import type { Emitter } from "./emitter";
import { relative, StopState } from "./layout";
import { BlockType, Op } from "./wasm-opcodes";

/** Deep enough for ordinary guest call chains, shallow enough for Safari's main-thread stack. */
export const MaxCallDepth = 128;

/**
 * Transfers to other translated functions are nested Wasm calls, so loops across functions or code pages would
 * grow the stack without bound. At the limit the transfer stops with `Unwind` and returns its target PC; every
 * frame passes it up and the runner continues there.
 */
export function nestedCall(e: Emitter, target: () => void, call: () => void): void {
  const { c, L } = e,
    depth = relative(L, L.depth);
  c.arena().memory(Op.I32Load, depth).i32(MaxCallDepth).op(Op.I32GeU).op(Op.If, BlockType.Empty);
  c.arena().i32(StopState.Unwind).memory(Op.I32Store, relative(L, L.stopped));
  target();
  c.op(Op.Return).op(Op.End);
  c.arena().arena().memory(Op.I32Load, depth).i32(1).op(Op.I32Add).memory(Op.I32Store, depth);
  target();
  call();
  c.arena().arena().memory(Op.I32Load, depth).i32(1).op(Op.I32Sub).memory(Op.I32Store, depth);
}
