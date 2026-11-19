import { read32, type GuestMemory } from "../../memory/guest-memory";
import {
  ARGUMENT_REGISTERS,
  CallKind,
  CallState,
  GraphicsStatistic,
  type CallRequest,
  type GraphicsChannel,
} from "./graphics-channel";

/** A GL import as gles.mjs implements it: `a(n)` reads argument n. */
export type GraphicsFunction = (a: (n: number) => number) => unknown;
/** Runs an Allocate or Present command for the main thread. */
export type GraphicsCommand = (kind: CallKind, payload: unknown) => number;
/** The registers a GL call reads and writes on the thread that runs it. */
export interface CallingThread {
  register(index: number): number;
  setResult(value: number): void;
  /** The thread's EAGL rendering API and current context. */
  readonly api: number;
  readonly context: number;
}

const Register = { Result: 0, Sp: 13, Lr: 14 } as const;
const WORD_BYTES = 4;
const DRAWS: ReadonlySet<string> = new Set(["_glDrawArrays", "_glDrawElements"]);
const CLEAR = "_glClear";
const IDLE_WAIT_MS = 1000;
const HEX = 16;

/** A host function's return value as the word it leaves in r0, or undefined for none. */
function resultWord(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number") return value >>> 0;
  if (value === null) return 0;
  throw new Error(`GL call returned an unsupported ${typeof value}.`);
}
const isPromise = (value: unknown): value is Promise<unknown> => value instanceof Promise;
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs GL imports where the WebGL context lives: calls the main thread forwards through the
 * channel, and calls the owner's own guest thread makes at its gates.
 */
export class GraphicsServer {
  readonly #gates = new Map<number, number>();
  readonly #functions: readonly (GraphicsFunction | undefined)[];
  /** The thread whose GL call runs now; gles.mjs asks it for the current EAGL context. */
  #current: { readonly api: number; readonly context: number } = { api: 0, context: 0 };
  #asynchronous = 0;
  constructor(
    readonly channel: GraphicsChannel,
    private readonly memory: GuestMemory,
    readonly names: readonly string[],
    api: Readonly<Record<string, GraphicsFunction | undefined>>,
    private readonly command: GraphicsCommand,
  ) {
    this.#functions = names.map((name) => api[name]);
  }
  get api(): number {
    return this.#current.api;
  }
  get context(): number {
    return this.#current.context;
  }
  /** Asynchronous calls still running; the worker must reach its event loop to finish them. */
  get asynchronous(): boolean {
    return this.#asynchronous > 0;
  }
  /** Gate PCs of GL imports, as pairs of PC and function index. */
  setGates(gates: readonly (readonly [number, number])[]): void {
    for (const [pc, index] of gates) this.#gates.set(pc, index);
  }
  has(pc: number): boolean {
    return this.#gates.has(pc);
  }
  #invoke(index: number, thread: CallingThread): unknown {
    const name = this.names[index] ?? "",
      fn = this.#functions[index];
    if (!fn) throw new Error(`Missing GL import ${name}.`);
    this.#current = { api: thread.api, context: thread.context };
    const sp = thread.register(Register.Sp);
    return fn((n) =>
      n < ARGUMENT_REGISTERS
        ? thread.register(n)
        : read32(this.memory, sp + (n - ARGUMENT_REGISTERS) * WORD_BYTES),
    );
  }
  /** Runs the GL import at gate `pc` for the owner's thread; resolves to the PC to resume at. */
  local(pc: number, thread: CallingThread): number | Promise<number> {
    const index = this.#gates.get(pc);
    if (index === undefined) throw new Error(`No GL import at gate 0x${pc.toString(HEX)}.`);
    // The main thread counts the calls it forwards itself.
    const name = this.names[index];
    if (name && DRAWS.has(name)) this.channel.add(GraphicsStatistic.DrawCalls, 1);
    else if (name === CLEAR) this.channel.add(GraphicsStatistic.ClearCalls, 1);
    const started = performance.now(),
      finish = (value: unknown): number => {
        const word = resultWord(value);
        if (word !== undefined) thread.setResult(word);
        this.channel.add(GraphicsStatistic.LocalCalls, 1);
        this.channel.add(GraphicsStatistic.LocalMs, performance.now() - started);
        return thread.register(Register.Lr);
      };
    const value = this.#invoke(index, thread);
    return isPromise(value) ? value.then(finish) : finish(value);
  }
  #forwarded(request: CallRequest): CallingThread {
    return {
      register: (index) =>
        index === Register.Sp ? request.sp : (request.registers[index] ?? 0) >>> 0,
      setResult: () => {},
      api: request.api,
      context: request.context,
    };
  }
  /** Answers a request the main thread forwarded; false when none was waiting. */
  serve(): boolean {
    if (this.channel.callState !== CallState.Request) return false;
    const request = this.channel.take();
    if (!request) return false;
    const started = performance.now(),
      done = (outcome: { value: number | undefined } | { error: string }): void => {
        this.channel.add(GraphicsStatistic.ForwardedCalls, 1);
        this.channel.add(GraphicsStatistic.ForwardedMs, performance.now() - started);
        this.channel.complete(outcome);
      };
    let value: unknown;
    try {
      value =
        request.kind === CallKind.Function
          ? this.#invoke(request.index, this.#forwarded(request))
          : this.command(request.kind, request.payload);
    } catch (error) {
      done({ error: message(error) });
      return true;
    }
    if (!isPromise(value)) {
      done({ value: resultWord(value) });
      return true;
    }
    this.#asynchronous++;
    this.channel.pend();
    value
      .then((resolved) => done({ value: resultWord(resolved) }))
      .catch((error: unknown) => done({ error: message(error) }))
      .finally(() => this.#asynchronous--);
    return true;
  }
  /** Serves forwarded calls whenever the worker's event loop runs, until `closed` says stop. */
  async idle(closed: () => boolean): Promise<void> {
    while (!closed()) {
      this.serve();
      const state = this.channel.callState;
      if (state !== CallState.Request) await this.channel.changed(state, IDLE_WAIT_MS);
    }
  }
}
