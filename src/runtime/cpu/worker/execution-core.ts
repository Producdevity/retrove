import { stateLayout, type StateLayout } from "../translation/layout";
import {
  RequestKind,
  ResponseKind,
  ThreadChannel,
  WorkerControl,
  type ChannelRequest,
} from "./channel";
import {
  ExecutionMessage,
  isToWorker,
  type CodeMessage,
  type WorkerPort,
  type StartMessage,
  type TrapRange,
} from "./protocol";
import { WorkerCode } from "./worker-code";
import { runWorkerSlice } from "./worker-runner";
import type { CallingThread } from "../../graphics/remote/graphics-server";
import type { WorkerGraphics } from "../../graphics/remote/graphics-owner";

/** The GL owner on this worker, if the main thread moved its WebGL context here. */
export interface GraphicsService {
  /** Handles a graphics message; false when the message is not one. */
  receive(message: unknown): boolean;
  readonly owner: WorkerGraphics | undefined;
}

/** Instructions per slice; the worker checks for stop requests and code flushes between slices. */
export const WORKER_SLICE = 65_536;
const THUMB_BIT = 1;
const WORD_BYTES = 4;
const RESULT_REGISTER = 0;

/** Lets the worker's event loop run once: OffscreenCanvas frames show and async work finishes. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
/**
 * Table slots kept beyond the main table's length. The main thread can install modules while this
 * worker runs a slice, and translated code may already reach their slots through the shared index;
 * far more functions than one slice could see installed.
 */
const TABLE_HEADROOM = 65_536;

/** Runs one guest thread on translated code until it returns to `until`, exits or is stopped. */
export class ExecutionThread {
  readonly #channel: ThreadChannel;
  readonly #control: WorkerControl;
  readonly #code: WorkerCode;
  readonly #view: DataView;
  readonly #traps: readonly TrapRange[];
  #layout: StateLayout;
  #codeWaiter: ((message: CodeMessage) => void) | undefined;
  constructor(
    private readonly start: StartMessage,
    private readonly graphics: () => WorkerGraphics | undefined = () => undefined,
  ) {
    this.#control = new WorkerControl(start.control);
    this.#channel = new ThreadChannel(this.#control, start.channel);
    this.#view = new DataView(start.memory.buffer);
    this.#traps = start.traps;
    this.#layout = { ...stateLayout(start.state, start.layout, start.layout.index) };
    if (start.layout.foreign) this.#layout = { ...this.#layout, foreign: start.layout.foreign };
    this.#code = new WorkerCode(start.memory, () => this.#layout, this.#control.generation);
  }
  /** Delivers a code reply from the main thread. */
  receive(message: CodeMessage): void {
    this.#layout = { ...this.#layout, index: message.index };
    if (message.generation === this.#control.generation) {
      if (message.generation !== this.#code.generation) this.#code.renew(message.generation);
      this.#code.install(message.compiled);
    }
    this.#channel.answer();
    const waiter = this.#codeWaiter;
    this.#codeWaiter = undefined;
    waiter?.(message);
  }
  #trapped(pc: number): boolean {
    const address = (pc & ~THUMB_BIT) >>> 0;
    return this.#traps.some((trap) => address >= trap.first && address <= trap.last);
  }
  #request(kind: RequestKind, pc: number, tries = 0, missing = false): ChannelRequest {
    return { kind, pc, tries, missing };
  }
  async #fetch(pc: number, tries: number, missing: boolean): Promise<void> {
    const reply = new Promise<CodeMessage>((resolve) => {
      this.#codeWaiter = resolve;
    });
    this.#channel.post(this.#request(RequestKind.Code, pc, tries, missing));
    await reply;
  }
  /** Whether this worker has an instance of the main thread's translation at `pc`. */
  #ready(pc: number): boolean {
    const entry = this.#code.entry(pc);
    return entry > 0 && this.#code.has(entry - 1);
  }
  /** Runs translated code from `pc`; returns the PC it stopped at and why. */
  #slice(pc: number, budget: number) {
    const worker = this.start.worker,
      started = performance.now();
    this.#code.reserve(this.#control.slots + TABLE_HEADROOM);
    if (!this.#control.enter(worker, this.#code.generation)) return undefined;
    try {
      return runWorkerSlice(this.#code, this.#view, this.#layout, pc, this.start.until, budget);
    } finally {
      this.#control.leave(worker);
      this.#channel.executed(performance.now() - started);
    }
  }
  /** This thread's registers for a GL call it makes on the worker that owns the context. */
  #callingThread(): CallingThread {
    const view = this.#view,
      registers = this.#layout.registers,
      { api, context } = this.#channel.graphicsState;
    return {
      register: (index) => view.getUint32(registers + WORD_BYTES * index, true),
      setResult: (value) =>
        view.setUint32(registers + WORD_BYTES * RESULT_REGISTER, value >>> 0, true),
      api,
      context,
    };
  }
  /** Answers the main thread's GL requests; yields when a frame or async GL work waits. */
  async #serveGraphics(graphics: WorkerGraphics): Promise<void> {
    graphics.serve();
    if (graphics.takeFrame() || graphics.asynchronous) await nextTask();
  }
  /** Runs the host call at gate `pc`; returns where to resume, or undefined when the thread ended. */
  async #hostCall(pc: number, graphics: WorkerGraphics | undefined): Promise<number | undefined> {
    if (graphics?.has(pc)) {
      const next = graphics.local(pc, this.#callingThread());
      return typeof next === "number" ? next : await next;
    }
    const answer = this.#channel.call(
      this.#request(RequestKind.HostCall, pc),
      graphics && (() => graphics.serve()),
    );
    return answer.result === ResponseKind.Finish ? undefined : answer.pc;
  }
  async run(): Promise<void> {
    let pc = this.start.pc,
      budget = WORKER_SLICE,
      tries = 0,
      missing = false;
    while (!this.#channel.stopped) {
      const graphics = this.graphics();
      if (graphics) await this.#serveGraphics(graphics);
      if (this.#trapped(pc)) {
        const next = await this.#hostCall(pc, graphics);
        if (next === undefined) return;
        [pc, budget, tries] = [next, WORKER_SLICE, 0];
        continue;
      }
      if ((pc & ~THUMB_BIT) === (this.start.until & ~THUMB_BIT)) {
        this.#channel.call(this.#request(RequestKind.Exit, pc));
        return;
      }
      const generation = this.#control.generation;
      if (generation !== this.#code.generation) this.#code.renew(generation);
      if (!this.#ready(pc) || tries > 0) {
        await this.#fetch(pc, tries, missing);
        missing = false;
        // A flush between the request and its reply leaves the slot empty; ask again.
        if (!this.#ready(pc)) continue;
      }
      const result = this.#slice(pc, budget);
      if (!result) continue;
      if (result.reason === "fallback") {
        budget = Math.max(1, this.#view.getInt32(this.#layout.budget, true));
        tries = result.pc === pc ? tries + 1 : 0;
        [pc, missing] = [result.pc, result.missing];
      } else if (result.reason === "budget") [pc, budget, tries] = [result.pc, WORKER_SLICE, 0];
      else pc = result.pc;
    }
  }
}

/** Serves one execution worker: each start message runs a thread; code replies feed the running one. */
export function serveExecution(port: WorkerPort, graphics?: GraphicsService): void {
  let thread: ExecutionThread | undefined;
  port.listen((message) => {
    if (graphics?.receive(message) || !isToWorker(message)) return;
    if (message.type === ExecutionMessage.Code) {
      thread?.receive(message);
      return;
    }
    const current = new ExecutionThread(message, () => graphics?.owner);
    thread = current;
    current.run().catch((error: unknown) => {
      port.post({ type: ExecutionMessage.Failed, message: String(error) });
    });
  });
}
