import type { Heap } from "../../memory/guest-memory";
import {
  CallKind,
  CallState,
  type GraphicsChannel,
  GraphicsStatistic,
  HeapOperation,
  type CallResult,
} from "./graphics-channel";

/** Spins between clock reads while waiting for the GL owner. */
const SPINS_PER_CHECK = 1024;
/** A GL owner that answers nothing for this long has failed. */
const ANSWER_TIMEOUT_MS = 30_000;
const PENDING_WAIT_MS = 50;

export interface GraphicsLinkHost {
  /** Guest heap operations the GL owner asks for. */
  readonly heap: Pick<Heap, "alloc" | "free">;
  /** Wakes the GL owner when its guest thread is blocked on the main thread. */
  wake(): void;
  /** Waits for `promise` while the main thread keeps answering worker threads. */
  idle<T>(promise: Promise<T>): Promise<T>;
  /** Sends the owner the gate PCs of GL imports (pairs of PC and function index, flattened). */
  gates(gates: readonly number[]): void;
}
export interface ForwardedCall {
  readonly registers: readonly number[];
  readonly sp: number;
  readonly api: number;
  readonly context: number;
}
export interface GraphicsLinkStatistics {
  /** GL calls the owner's own thread made without a round trip. */
  readonly localCalls: number;
  readonly localMs: number;
  /** Calls and commands the main thread forwarded to the owner. */
  readonly forwardedCalls: number;
  /** Main-thread milliseconds spent waiting for forwarded calls. */
  readonly forwardWaitMs: number;
  readonly drawCalls: number;
  readonly clearCalls: number;
}

/**
 * The main thread's end of the WebGL context that lives on an execution worker. Forwarded calls
 * wait synchronously: the owner answers between its own guest thread's slices, while that thread
 * waits on the main thread, and from its event loop when idle.
 */
export class GraphicsLink {
  readonly #indices: ReadonlyMap<string, number>;
  #waitMs = 0;
  #forwarded = 0;
  constructor(
    readonly channel: GraphicsChannel,
    readonly names: readonly string[],
    private readonly host: GraphicsLinkHost,
  ) {
    this.#indices = new Map(names.map((name, index) => [name, index]));
  }
  index(name: string): number | undefined {
    return this.#indices.get(name);
  }
  /** Tells the owner which gate PCs are GL imports, so its own thread calls them in place. */
  setGates(gates: Iterable<readonly [number, string]>): void {
    const flat: number[] = [];
    for (const [pc, name] of gates) {
      const index = this.index(name);
      if (index !== undefined) flat.push(pc, index);
    }
    this.host.gates(flat);
  }
  /** Answers a heap request from the GL owner; false when none was waiting. */
  serve(): boolean {
    return this.channel.serveHeap((operation, argument) => {
      if (operation === HeapOperation.Free) {
        this.host.heap.free(argument);
        return 0;
      }
      return this.host.heap.alloc(argument);
    });
  }
  #settle(result: CallResult): number | undefined {
    if (!result.done) throw new Error("Graphics call settled before it finished.");
    if ("error" in result) throw new Error(result.error);
    return result.value;
  }
  #send(
    kind: CallKind,
    index: number,
    call: ForwardedCall,
    payload?: unknown,
  ): number | undefined | Promise<number | undefined> {
    const started = performance.now();
    this.#forwarded++;
    this.channel.request({ kind, index, ...call, payload });
    this.host.wake();
    try {
      for (let spins = 1; ; spins++) {
        const result = this.channel.result();
        if (result.done) return this.#settle(result);
        if (result.pending) return this.#later();
        this.serve();
        if (spins % SPINS_PER_CHECK !== 0) continue;
        // A preemption can lose a race with the owner starting its next slice.
        this.host.wake();
        if (performance.now() - started > ANSWER_TIMEOUT_MS)
          throw new Error("The graphics worker stopped answering.");
      }
    } finally {
      this.#waitMs += performance.now() - started;
    }
  }
  async #later(): Promise<number | undefined> {
    const started = performance.now();
    for (;;) {
      const result = this.channel.result();
      if (result.done) {
        this.#waitMs += performance.now() - started;
        return this.#settle(result);
      }
      this.serve();
      await this.host.idle(this.channel.changed(CallState.Pending, PENDING_WAIT_MS));
    }
  }
  /** Runs GL function `index` on the owner with the caller's argument registers. */
  call(index: number, call: ForwardedCall): number | undefined | Promise<number | undefined> {
    return this.#send(CallKind.Function, index, call);
  }
  /** Runs an EAGL drawable command on the owner. */
  command(kind: typeof CallKind.Allocate | typeof CallKind.Present, payload: unknown): number {
    const result = this.#send(kind, 0, { registers: [], sp: 0, api: 0, context: 0 }, payload);
    if (typeof result !== "number") throw new Error("A drawable command did not finish.");
    return result;
  }
  statistics(): GraphicsLinkStatistics {
    const statistic = (which: GraphicsStatistic) => this.channel.statistic(which);
    return {
      localCalls: statistic(GraphicsStatistic.LocalCalls),
      localMs: statistic(GraphicsStatistic.LocalMs),
      forwardedCalls: this.#forwarded,
      forwardWaitMs: this.#waitMs,
      drawCalls: statistic(GraphicsStatistic.DrawCalls),
      clearCalls: statistic(GraphicsStatistic.ClearCalls),
    };
  }
}
