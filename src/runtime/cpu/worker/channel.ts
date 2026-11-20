import { PageBytes, StateBytes } from "../translation/layout";

const WORD_BYTES = 4;
const FLOAT_BYTES = 8;
/** The main thread's state block is the first of the state page; workers use the others. */
export const MaxWorkerThreads = PageBytes / StateBytes - 1;

const Control = { Generation: 0, Doorbell: 1, Slots: 2, Active: 3 } as const;
const POLL_MS = 1;

declare global {
  // ES2024's Atomics.waitAsync; absent from the ES2023 library and from older Safari.
  interface Atomics {
    waitAsync?(
      array: Int32Array<SharedArrayBuffer>,
      index: number,
      value: number,
      timeout?: number,
    ): { async: false; value: string } | { async: true; value: Promise<string> };
  }
}
const CONTROL_WORDS = Control.Active + MaxWorkerThreads;

/**
 * Words every execution worker shares with the main thread: the code generation (bumped when the
 * main thread drops every module), a doorbell counting requests, the main table's length, and per
 * worker whether it is inside translated code.
 */
export class WorkerControl {
  readonly words: Int32Array<SharedArrayBuffer>;
  constructor(readonly buffer = new SharedArrayBuffer(CONTROL_WORDS * WORD_BYTES)) {
    this.words = new Int32Array(buffer);
  }
  get generation(): number {
    return Atomics.load(this.words, Control.Generation);
  }
  /**
   * Bumps the generation, then waits until no worker is inside translated code. A worker sets its
   * flag before reading the generation, so after this returns none runs code from before the bump.
   */
  advance(): void {
    Atomics.add(this.words, Control.Generation, 1);
    for (let worker = 0; worker < MaxWorkerThreads; worker++)
      while (Atomics.load(this.words, Control.Active + worker) !== 0);
  }
  /** Marks a worker inside translated code; false (and unmarked) when the generation moved on. */
  enter(worker: number, generation: number): boolean {
    Atomics.store(this.words, Control.Active + worker, 1);
    if (Atomics.load(this.words, Control.Generation) === generation) return true;
    this.leave(worker);
    return false;
  }
  leave(worker: number): void {
    Atomics.store(this.words, Control.Active + worker, 0);
  }
  /** Slots in the main thread's function table; it only grows. */
  get slots(): number {
    return Atomics.load(this.words, Control.Slots);
  }
  publishSlots(slots: number): void {
    Atomics.store(this.words, Control.Slots, Math.max(slots, this.slots));
  }
  get doorbell(): number {
    return Atomics.load(this.words, Control.Doorbell);
  }
  ring(): void {
    Atomics.add(this.words, Control.Doorbell, 1);
    Atomics.notify(this.words, Control.Doorbell);
  }
  /** Resolves when the doorbell differs from `seen` or after `timeoutMs`; polls without waitAsync. */
  async changed(seen: number, timeoutMs: number): Promise<void> {
    const result = Atomics.waitAsync?.(this.words, Control.Doorbell, seen, timeoutMs);
    if (!result) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    else if (result.async) await result.value;
  }
}

export const ChannelState = { Idle: 0, Request: 1, Taken: 2, Response: 3 } as const;
export const RequestKind = { HostCall: 1, Exit: 2, Code: 3 } as const;
export type RequestKind = (typeof RequestKind)[keyof typeof RequestKind];
export const ResponseKind = { Resume: 1, Finish: 2, Code: 3 } as const;
export type ResponseKind = (typeof ResponseKind)[keyof typeof ResponseKind];
const Word = {
  State: 0,
  Kind: 1,
  Pc: 2,
  Tries: 3,
  Missing: 4,
  Result: 5,
  ResumePc: 6,
  Stop: 7,
  /** Counts events the blocked worker must look at: answers and graphics requests. */
  Signal: 8,
  /** The thread's EAGL rendering API and current context, for GL calls it makes on its worker. */
  Api: 9,
  Context: 10,
} as const;
// Even, so the statistics after the words stay 8-byte aligned.
const CHANNEL_WORDS = 12;
/** How long a request may wait untaken before the worker preempts the main thread again. */
const UNTAKEN_WAIT_MS = 2;
const Statistic = { Calls: 0, TotalMs: 1, MaxMs: 2, ExecuteMs: 3, LocalCalls: 4 } as const;
const STATISTICS = 5;

export interface ChannelRequest {
  readonly kind: RequestKind;
  /** Guest PC (with the Thumb bit) of the host gate or the code wanted. */
  readonly pc: number;
  readonly tries: number;
  /** The worker left translated code at an entry its function has no label for. */
  readonly missing: boolean;
}
export interface HostCallStatistics {
  readonly calls: number;
  readonly totalMs: number;
  readonly maxMs: number;
  /** Worker milliseconds spent running translated code. */
  readonly executeMs: number;
  /** Imports the worker answered itself, in place. */
  readonly localCalls: number;
}

/**
 * One guest thread's request slot. The worker writes a request and blocks (host calls) or waits
 * for a message (code); the main thread takes it at a slice boundary and answers. The thread's
 * registers travel in its state block, not here.
 */
export class ThreadChannel {
  readonly words: Int32Array<SharedArrayBuffer>;
  readonly #statistics: Float64Array<SharedArrayBuffer>;
  constructor(
    readonly control: WorkerControl,
    readonly buffer = new SharedArrayBuffer(CHANNEL_WORDS * WORD_BYTES + STATISTICS * FLOAT_BYTES),
  ) {
    this.words = new Int32Array(buffer, 0, CHANNEL_WORDS);
    this.#statistics = new Float64Array(buffer, CHANNEL_WORDS * WORD_BYTES, STATISTICS);
  }
  /** Worker side: asks the main thread to answer now rather than at the end of its slice. */
  preempt: (() => void) | undefined;
  /** Worker side: publishes a request without waiting for its answer. */
  post(request: ChannelRequest): void {
    const words = this.words;
    words[Word.Kind] = request.kind;
    words[Word.Pc] = request.pc;
    words[Word.Tries] = request.tries;
    words[Word.Missing] = request.missing ? 1 : 0;
    Atomics.store(words, Word.State, ChannelState.Request);
    this.control.ring();
    this.preempt?.();
  }
  /**
   * Worker side: publishes a request and blocks until the main thread answers, running `wake`
   * whenever the main thread signals meanwhile.
   */
  call(
    request: ChannelRequest,
    wake?: () => void,
  ): { readonly result: number; readonly pc: number } {
    const started = performance.now();
    this.post(request);
    for (;;) {
      const signal = Atomics.load(this.words, Word.Signal);
      if (Atomics.load(this.words, Word.State) === ChannelState.Response) break;
      wake?.();
      const waited = Atomics.wait(this.words, Word.Signal, signal, UNTAKEN_WAIT_MS);
      if (waited === "timed-out" && Atomics.load(this.words, Word.State) === ChannelState.Request)
        this.preempt?.();
    }
    const answer = this.answer();
    if (request.kind === RequestKind.HostCall) this.#record(performance.now() - started);
    return answer;
  }
  /** Worker side: reads the answer and frees the slot. */
  answer(): { readonly result: number; readonly pc: number } {
    const result = this.words[Word.Result] ?? 0,
      pc = this.words[Word.ResumePc] ?? 0;
    Atomics.store(this.words, Word.State, ChannelState.Idle);
    return { result, pc: pc >>> 0 };
  }
  // Only the worker writes these; the main thread reads them for diagnostics.
  #record(milliseconds: number): void {
    const statistics = this.#statistics;
    statistics[Statistic.Calls] = (statistics[Statistic.Calls] ?? 0) + 1;
    statistics[Statistic.TotalMs] = (statistics[Statistic.TotalMs] ?? 0) + milliseconds;
    statistics[Statistic.MaxMs] = Math.max(statistics[Statistic.MaxMs] ?? 0, milliseconds);
  }
  /** Worker side. */
  executed(milliseconds: number): void {
    this.#statistics[Statistic.ExecuteMs] =
      (this.#statistics[Statistic.ExecuteMs] ?? 0) + milliseconds;
  }
  /** Worker side: counts an import answered on the worker. */
  local(): void {
    this.#statistics[Statistic.LocalCalls] = (this.#statistics[Statistic.LocalCalls] ?? 0) + 1;
  }
  get statistics(): HostCallStatistics {
    const statistics = this.#statistics;
    return {
      calls: statistics[Statistic.Calls] ?? 0,
      totalMs: statistics[Statistic.TotalMs] ?? 0,
      maxMs: statistics[Statistic.MaxMs] ?? 0,
      executeMs: statistics[Statistic.ExecuteMs] ?? 0,
      localCalls: statistics[Statistic.LocalCalls] ?? 0,
    };
  }
  /** Main side: the waiting request, now marked taken, or undefined. */
  take(): ChannelRequest | undefined {
    const words = this.words;
    if (
      Atomics.compareExchange(words, Word.State, ChannelState.Request, ChannelState.Taken) !==
      ChannelState.Request
    )
      return undefined;
    const kind = words[Word.Kind];
    if (kind !== RequestKind.HostCall && kind !== RequestKind.Exit && kind !== RequestKind.Code)
      throw new Error(`Execution worker sent an unknown request ${String(kind)}.`);
    return {
      kind,
      pc: (words[Word.Pc] ?? 0) >>> 0,
      tries: words[Word.Tries] ?? 0,
      missing: words[Word.Missing] === 1,
    };
  }
  /** Main side: answers the taken request and wakes the worker. */
  respond(result: ResponseKind, pc = 0): void {
    const words = this.words;
    words[Word.Result] = result;
    words[Word.ResumePc] = pc | 0;
    Atomics.store(words, Word.State, ChannelState.Response);
    this.signal();
  }
  /** Wakes the worker if it is blocked in `call`. */
  signal(): void {
    Atomics.add(this.words, Word.Signal, 1);
    Atomics.notify(this.words, Word.Signal);
  }
  /** The thread's EAGL rendering API and current context, as the main thread last saw them. */
  get graphicsState(): { readonly api: number; readonly context: number } {
    return {
      api: Atomics.load(this.words, Word.Api),
      context: Atomics.load(this.words, Word.Context) >>> 0,
    };
  }
  setGraphicsState(api: number, context: number): void {
    Atomics.store(this.words, Word.Api, api | 0);
    Atomics.store(this.words, Word.Context, context | 0);
  }
  /** Asks the worker to stop at its next slice boundary. */
  stop(): void {
    Atomics.store(this.words, Word.Stop, 1);
  }
  get stopped(): boolean {
    return Atomics.load(this.words, Word.Stop) === 1;
  }
}
