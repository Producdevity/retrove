import { GuestState } from "../own/guest-state";
import { StateBytes, stateLayout, type ArenaRegion } from "../translation/layout";
import { MaxWorkerThreads, ThreadChannel } from "./channel";
import type { ModuleRegistry } from "./module-registry";
import { ExecutionMessage, isFailedMessage, type ExecutionPort, type TrapRange } from "./protocol";
import { RemoteThread, type WorkerCpu } from "./remote-thread";

const Register = { SP: 13, LR: 14 } as const;
const GENERAL_REGISTERS = 13;
/** Longest idle wait before the doorbell is checked again (a missed wakeup costs at most this). */
const IDLE_WAIT_MS = 50;
const US_PER_MS = 1000;

export interface ThreadStart {
  readonly id: number;
  readonly pc: number;
  readonly args: readonly number[];
  readonly sp: number;
  /** Guest thread pointer (TPIDRURO). */
  readonly pointer: number;
  readonly returnAddress: number;
}
export interface WorkerThreadOptions {
  /** Picks the guest threads that run on an execution worker; the rest stay cooperative. */
  readonly place: (thread: { readonly id: number; readonly pc: number }) => boolean;
  readonly spawn: () => ExecutionPort;
}
function browserWorker(): ExecutionPort {
  const worker = new Worker(new URL("./execution-worker.ts", import.meta.url), { type: "module" });
  return {
    post: (message) => {
      worker.postMessage(message);
    },
    listen: (handler) => {
      worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        handler(event.data);
      });
      worker.addEventListener("error", (event) => {
        handler({ type: ExecutionMessage.Failed, message: event.message });
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}
let configured: WorkerThreadOptions = { place: () => false, spawn: browserWorker };
/** No thread is placed on a worker unless a caller configures a predicate (tests and experiments). */
export function configureWorkerThreads(options: Partial<WorkerThreadOptions>): void {
  configured = { ...configured, ...options };
}
export interface WorkerThreadStatistics {
  readonly threads: number;
  readonly hostCalls: number;
  readonly roundTripMs: number;
  readonly meanRoundTripUs: number;
  readonly maxRoundTripMs: number;
  readonly hostMs: number;
  readonly codeRequests: number;
}
interface ExecutionWorker {
  readonly port: ExecutionPort;
  thread: RemoteThread | undefined;
}
type Totals = { -readonly [K in keyof WorkerThreadStatistics]: WorkerThreadStatistics[K] };

/**
 * Guest threads on execution workers. Each worker owns one state block in the arena's state page
 * after the main thread's, which guest code cannot address, and runs one thread at a time.
 */
export class WorkerThreads {
  readonly #workers: (ExecutionWorker | undefined)[] = [];
  readonly #finished: Totals = WorkerThreads.#empty();
  #seen = 0;
  constructor(
    private readonly cpu: WorkerCpu & { readonly traps: readonly TrapRange[] },
    private readonly registry: ModuleRegistry,
    private readonly memory: WebAssembly.Memory,
    private readonly arena: { readonly arena: number; readonly region: ArenaRegion },
  ) {}
  static #empty(): Totals {
    return {
      threads: 0,
      hostCalls: 0,
      roundTripMs: 0,
      meanRoundTripUs: 0,
      maxRoundTripMs: 0,
      hostMs: 0,
      codeRequests: 0,
    };
  }
  /** Starts the thread on a free worker when the predicate picks it; undefined keeps it cooperative. */
  place(start: ThreadStart): RemoteThread | undefined {
    if (!configured.place({ id: start.id, pc: start.pc })) return undefined;
    let index = this.#workers.findIndex((worker) => !worker?.thread);
    if (index < 0) index = this.#workers.length;
    if (index >= MaxWorkerThreads) return undefined;
    const worker = this.#workers[index] ?? this.#spawn(index),
      base = this.#initialize(index, start),
      channel = new ThreadChannel(this.registry.control);
    const thread = new RemoteThread(this.cpu, this.registry, worker.port, channel, base, () =>
      this.#release(index),
    );
    worker.thread = thread;
    const { arena, mask, index: code, foreign } = this.cpu.layout;
    worker.port.post({
      type: ExecutionMessage.Start,
      memory: this.memory,
      control: this.registry.control.buffer,
      channel: channel.buffer,
      worker: index,
      state: base,
      pc: start.pc,
      until: start.returnAddress,
      traps: this.cpu.traps,
      layout: foreign ? { arena, mask, index: code, foreign } : { arena, mask, index: code },
    });
    return thread;
  }
  #spawn(index: number): ExecutionWorker {
    const worker: ExecutionWorker = { port: configured.spawn(), thread: undefined };
    worker.port.listen((message) => {
      if (isFailedMessage(message)) worker.thread?.listen(message);
    });
    this.#workers[index] = worker;
    return worker;
  }
  /** Writes the thread's first registers into its state block. */
  #initialize(index: number, start: ThreadStart): number {
    const base = this.arena.arena + this.arena.region.state + StateBytes * (index + 1),
      L = stateLayout(base, this.cpu.layout, this.cpu.layout.index),
      view = this.cpu.view;
    new Uint8Array(view.buffer, base, StateBytes).fill(0);
    const state = new GuestState(
      () => L,
      () => view,
    );
    for (let register = 0; register < GENERAL_REGISTERS; register++)
      state.set(register, start.args[register] ?? 0);
    state.set(Register.SP, start.sp);
    state.set(Register.LR, start.returnAddress);
    state.threadPointer = start.pointer;
    return base;
  }
  #release(index: number): void {
    const worker = this.#workers[index],
      thread = worker?.thread;
    if (!worker || !thread) return;
    this.#add(this.#finished, thread);
    worker.thread = undefined;
  }
  #add(totals: Totals, thread: RemoteThread): void {
    const { calls, totalMs, maxMs } = thread.channel.statistics;
    totals.threads++;
    totals.hostCalls += calls;
    totals.roundTripMs += totalMs;
    totals.maxRoundTripMs = Math.max(totals.maxRoundTripMs, maxMs);
    totals.hostMs += thread.hostMs;
    totals.codeRequests += thread.codeRequests;
  }
  /** Whether a worker posted a request since `acknowledge`. */
  pending(): boolean {
    return this.registry.control.doorbell !== this.#seen;
  }
  /** Call before scanning the threads for requests, so later ones ring again. */
  acknowledge(): void {
    this.#seen = this.registry.control.doorbell;
  }
  /** Waits for `promise`, running `service` whenever a worker rings meanwhile. */
  async idle<T>(promise: Promise<T>, service: () => Promise<void>): Promise<T> {
    let settled = false;
    const done = promise.finally(() => {
      settled = true;
    });
    while (!settled) {
      const before = this.registry.control.doorbell;
      if (before !== this.#seen) await service();
      if (!settled && this.registry.control.doorbell === before)
        await Promise.race([done, this.registry.control.changed(before, IDLE_WAIT_MS)]);
    }
    return done;
  }
  statistics(): WorkerThreadStatistics {
    const totals = { ...this.#finished };
    for (const worker of this.#workers) if (worker?.thread) this.#add(totals, worker.thread);
    totals.meanRoundTripUs = totals.hostCalls
      ? (US_PER_MS * totals.roundTripMs) / totals.hostCalls
      : 0;
    return totals;
  }
  close(): void {
    this.#workers.forEach((worker, index) => {
      worker?.thread?.channel.stop();
      worker?.port.terminate();
      this.registry.control.leave(index);
    });
    this.#workers.length = 0;
  }
}
