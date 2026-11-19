const WORD_BYTES = 4;
const FLOAT_BYTES = 8;
/** Without Atomics.waitAsync, waits poll this often. */
const POLL_MS = 1;
/** Bytes for a command's JSON or an error message. */
export const PAYLOAD_BYTES = 4096;

/** Who holds the call slot: the main thread writes requests, the GL owner answers them. */
export const CallState = { Idle: 0, Request: 1, Taken: 2, Pending: 3, Response: 4 } as const;
export const HeapState = { Idle: 0, Request: 1, Taken: 2, Response: 3 } as const;
/** A forwarded GL function, or a command the GL owner runs for the main thread. */
export const CallKind = { Function: 1, Allocate: 2, Present: 3 } as const;
export type CallKind = (typeof CallKind)[keyof typeof CallKind];
export const HeapOperation = { Allocate: 1, Free: 2 } as const;
export type HeapOperation = (typeof HeapOperation)[keyof typeof HeapOperation];
const Outcome = { Undefined: 0, Value: 1, Error: 2 } as const;

const Word = {
  CallState: 0,
  Kind: 1,
  Function: 2,
  Registers: 3,
  Sp: 7,
  Api: 8,
  Context: 9,
  Outcome: 10,
  Result: 11,
  PayloadBytes: 12,
  HeapState: 13,
  HeapOperation: 14,
  HeapArgument: 15,
  HeapResult: 16,
} as const;
const WORDS = 18;
export const ARGUMENT_REGISTERS = 4;

/** Counters only the GL owner writes; the main thread reads them for reports. */
export const GraphicsStatistic = {
  LocalCalls: 0,
  LocalMs: 1,
  ForwardedCalls: 2,
  ForwardedMs: 3,
  DrawCalls: 4,
  ClearCalls: 5,
  Presents: 6,
  TextureBytes: 7,
  BufferBytes: 8,
  RenderbufferBytes: 9,
} as const;
export type GraphicsStatistic = (typeof GraphicsStatistic)[keyof typeof GraphicsStatistic];
const STATISTICS = 10;

export interface CallRequest {
  readonly kind: CallKind;
  /** Index into the owner's GL function names. */
  readonly index: number;
  readonly registers: readonly number[];
  readonly sp: number;
  /** The calling thread's EAGL rendering API and context. */
  readonly api: number;
  readonly context: number;
  /** Command arguments. */
  readonly payload: unknown;
}
export type CallResult =
  | { readonly done: true; readonly value: number | undefined }
  | { readonly done: true; readonly error: string }
  | { readonly done: false; readonly pending: boolean };

const encoder = new TextEncoder(),
  decoder = new TextDecoder();

/**
 * The shared slots between the main thread and the execution worker that owns the WebGL context:
 * one call slot (main to owner) and one heap slot (owner to main, for guest allocations a GL call
 * needs while it runs).
 */
export class GraphicsChannel {
  readonly words: Int32Array<SharedArrayBuffer>;
  readonly #statistics: Float64Array<SharedArrayBuffer>;
  readonly #payload: Uint8Array<SharedArrayBuffer>;
  constructor(
    readonly buffer = new SharedArrayBuffer(
      WORDS * WORD_BYTES + STATISTICS * FLOAT_BYTES + PAYLOAD_BYTES,
    ),
  ) {
    this.words = new Int32Array(buffer, 0, WORDS);
    this.#statistics = new Float64Array(buffer, WORDS * WORD_BYTES, STATISTICS);
    this.#payload = new Uint8Array(buffer, WORDS * WORD_BYTES + STATISTICS * FLOAT_BYTES);
  }
  #writeText(text: string): number {
    const bytes = encoder.encode(text).subarray(0, PAYLOAD_BYTES);
    this.#payload.set(bytes);
    return bytes.length;
  }
  #readText(length: number): string {
    return decoder.decode(this.#payload.slice(0, Math.min(length, PAYLOAD_BYTES)));
  }
  /** Main side: publishes a request; the caller wakes the owner. */
  request(call: CallRequest): void {
    const words = this.words;
    words[Word.Kind] = call.kind;
    words[Word.Function] = call.index;
    for (let register = 0; register < ARGUMENT_REGISTERS; register++)
      words[Word.Registers + register] = call.registers[register] ?? 0;
    words[Word.Sp] = call.sp;
    words[Word.Api] = call.api;
    words[Word.Context] = call.context;
    words[Word.PayloadBytes] =
      call.payload === undefined ? 0 : this.#writeText(JSON.stringify(call.payload));
    Atomics.store(words, Word.CallState, CallState.Request);
    Atomics.notify(words, Word.CallState);
  }
  /** Main side: the answer once there is one; frees the slot. */
  result(): CallResult {
    const state = Atomics.load(this.words, Word.CallState);
    if (state !== CallState.Response) return { done: false, pending: state === CallState.Pending };
    const outcome = this.words[Word.Outcome],
      value = (this.words[Word.Result] ?? 0) >>> 0;
    const result: CallResult =
      outcome === Outcome.Error
        ? { done: true, error: this.#readText(this.words[Word.PayloadBytes] ?? 0) }
        : { done: true, value: outcome === Outcome.Value ? value : undefined };
    Atomics.store(this.words, Word.CallState, CallState.Idle);
    return result;
  }
  /** Owner side: the waiting request, now taken, or undefined. */
  take(): CallRequest | undefined {
    const words = this.words;
    if (
      Atomics.compareExchange(words, Word.CallState, CallState.Request, CallState.Taken) !==
      CallState.Request
    )
      return undefined;
    const kind = words[Word.Kind];
    if (kind !== CallKind.Function && kind !== CallKind.Allocate && kind !== CallKind.Present)
      throw new Error(`Unknown graphics call kind ${String(kind)}.`);
    const length = words[Word.PayloadBytes] ?? 0,
      payload: unknown = length ? JSON.parse(this.#readText(length)) : undefined;
    return {
      kind,
      index: words[Word.Function] ?? 0,
      registers: Array.from(
        { length: ARGUMENT_REGISTERS },
        (_, register) => (words[Word.Registers + register] ?? 0) >>> 0,
      ),
      sp: (words[Word.Sp] ?? 0) >>> 0,
      api: words[Word.Api] ?? 0,
      context: (words[Word.Context] ?? 0) >>> 0,
      payload,
    };
  }
  /** Owner side: the taken request finishes later (an asynchronous GL function). */
  pend(): void {
    Atomics.store(this.words, Word.CallState, CallState.Pending);
    Atomics.notify(this.words, Word.CallState);
  }
  /** Owner side: answers the taken or pending request. */
  complete(outcome: { readonly value: number | undefined } | { readonly error: string }): void {
    const words = this.words;
    if ("error" in outcome) {
      words[Word.Outcome] = Outcome.Error;
      words[Word.PayloadBytes] = this.#writeText(outcome.error);
    } else {
      words[Word.Outcome] = outcome.value === undefined ? Outcome.Undefined : Outcome.Value;
      words[Word.Result] = (outcome.value ?? 0) | 0;
    }
    Atomics.store(words, Word.CallState, CallState.Response);
    Atomics.notify(words, Word.CallState);
  }
  get callState(): number {
    return Atomics.load(this.words, Word.CallState);
  }
  /** Resolves when the call slot leaves `state`, or at once if it already has. */
  async changed(state: number, timeoutMs: number): Promise<void> {
    const result = Atomics.waitAsync?.(this.words, Word.CallState, state, timeoutMs);
    if (!result) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    else if (result.async) await result.value;
  }
  /**
   * Owner side: asks the main thread for a heap operation and blocks until it answers; `ring`
   * tells the main thread a worker is waiting.
   */
  heap(operation: HeapOperation, argument: number, ring: () => void): number {
    const words = this.words;
    words[Word.HeapOperation] = operation;
    words[Word.HeapArgument] = argument | 0;
    Atomics.store(words, Word.HeapState, HeapState.Request);
    ring();
    for (;;) {
      const state = Atomics.load(words, Word.HeapState);
      if (state === HeapState.Response) break;
      Atomics.wait(words, Word.HeapState, state);
    }
    const result = (words[Word.HeapResult] ?? 0) >>> 0;
    Atomics.store(words, Word.HeapState, HeapState.Idle);
    return result;
  }
  /** Main side: performs a waiting heap request; false when there was none. */
  serveHeap(perform: (operation: HeapOperation, argument: number) => number): boolean {
    const words = this.words;
    if (
      Atomics.compareExchange(words, Word.HeapState, HeapState.Request, HeapState.Taken) !==
      HeapState.Request
    )
      return false;
    const operation =
      words[Word.HeapOperation] === HeapOperation.Free
        ? HeapOperation.Free
        : HeapOperation.Allocate;
    words[Word.HeapResult] = perform(operation, (words[Word.HeapArgument] ?? 0) >>> 0) | 0;
    Atomics.store(words, Word.HeapState, HeapState.Response);
    Atomics.notify(words, Word.HeapState);
    return true;
  }
  statistic(which: GraphicsStatistic): number {
    return this.#statistics[which] ?? 0;
  }
  /** Owner side. */
  add(which: GraphicsStatistic, amount: number): void {
    this.#statistics[which] = (this.#statistics[which] ?? 0) + amount;
  }
  /** Owner side. */
  set(which: GraphicsStatistic, value: number): void {
    this.#statistics[which] = value;
  }
}
