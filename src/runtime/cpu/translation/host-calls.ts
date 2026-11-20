import { StopState, type StateLayout } from "./layout";
import { MaxCallDepth } from "./emit-depth";

/**
 * Runs the host import at gate `pc` with the thread's registers in its state block. Returns the
 * PC execution continues at when the call completed on the spot, or undefined when it did not
 * (it waits, returns a promise, throws or transfers control): the dispatcher then leaves
 * translated code at the gate and the runner finishes the call.
 */
export type HostHandler = (pc: number) => number | undefined;

/** Frames left for guest code that a host call runs on the same stack. */
const NESTED_FRAMES = 32;
const DEPTH_LIMIT = MaxCallDepth - NESTED_FRAMES;
const NOT_HANDLED = 0;

/**
 * Host imports called from inside translated code, without unwinding its Wasm frames. Leaving
 * at every import cost one runner round trip per import and then one more per caller frame, as
 * each `return` found no Wasm frame to return to.
 */
export class HostCalls {
  handler: HostHandler | undefined;
  #base = 0;
  constructor(
    private readonly view: () => DataView,
    private readonly layout: () => StateLayout,
  ) {}
  /**
   * Call depth a run starts at. Guest code a host call runs shares the stack with the frames
   * below it, so the depth limit counts those frames too.
   */
  get baseDepth(): number {
    return this.#base;
  }
  /** The dispatcher's `env.host` import: the continuation PC, or 0 to leave at the gate. */
  readonly call = (pc: number): number => {
    const handler = this.handler;
    if (!handler) return NOT_HANDLED;
    const view = this.view(),
      L = this.layout(),
      depth = view.getUint32(L.depth, true);
    if (depth > DEPTH_LIMIT) return NOT_HANDLED;
    const budget = view.getInt32(L.budget, true),
      outer = this.#base;
    this.#base = depth;
    try {
      const next = handler(pc);
      if (next === undefined) return NOT_HANDLED;
      view.setUint32(L.stopped, StopState.Running, true);
      view.setUint32(L.depth, depth, true);
      view.setInt32(L.budget, budget, true);
      return next;
    } finally {
      this.#base = outer;
    }
  };
}
