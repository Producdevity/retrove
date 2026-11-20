import type { GraphicsLink, GraphicsLinkStatistics } from "../../graphics/remote/graphics-link";
import { GuestState } from "../own/guest-state";
import { StateBytes, stateLayout, type ArenaRegion } from "../translation/layout";
import { MaxWorkerThreads, ThreadChannel } from "./channel";
import { startGraphics, type GraphicsOptions } from "./graphics-start";
import type { ModuleRegistry } from "./module-registry";
import { Placement, type ThreadCandidate } from "./placement";
import { ExecutionMessage, isFailedMessage, type ExecutionPort, type TrapRange } from "./protocol";
import { RemoteThread, type WorkerCpu } from "./remote-thread";

const Register = { SP: 13, LR: 14 } as const;
const GENERAL_REGISTERS = 13;
/** Longest idle wait before the doorbell is checked again (a missed wakeup costs at most this). */
const IDLE_WAIT_MS = 50;
const US_PER_MS = 1000;

export interface ThreadStart extends ThreadCandidate {
  readonly sp: number;
  /** Guest thread pointer (TPIDRURO). */
  readonly pointer: number;
  readonly returnAddress: number;
}
export interface WorkerThreadOptions {
  /** Overrides the app profile's placement (tests and experiments); `true` means any worker. */
  readonly place: ((thread: ThreadCandidate) => boolean | Placement) | undefined;
  readonly spawn: () => ExecutionPort;
}
function browserWorker(): ExecutionPort {
  const worker = new Worker(new URL("./execution-worker.ts", import.meta.url), { type: "module" });
  return {
    post: (message, transfer = []) => {
      worker.postMessage(message, transfer);
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
let configured: WorkerThreadOptions = { place: undefined, spawn: browserWorker };
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
  /** Worker milliseconds spent running translated code. */
  readonly executeMs: number;
  /** Imports workers answered themselves. */
  readonly localCalls: number;
  /** Guest thread ids running on the worker that owns the WebGL context. */
  readonly graphicsThreads: readonly number[];
  readonly graphics?: GraphicsLinkStatistics;
}
interface ExecutionWorker {
  readonly port: ExecutionPort;
  thread: RemoteThread | undefined;
  readonly listeners: ((message: unknown) => void)[];
}
type Totals = {
  -readonly [K in Exclude<keyof WorkerThreadStatistics, "graphics" | "graphicsThreads">]: number;
};

/**
 * Guest threads on execution workers. Each worker owns one state block in the arena's state page
 * after the main thread's, which guest code cannot address, and runs one thread at a time.
 */
export class WorkerThreads {
  readonly #workers: (ExecutionWorker | undefined)[] = [];
  readonly #finished: Totals = WorkerThreads.#empty();
  readonly #graphicsThreads: number[] = [];
  #seen = 0;
  #graphics: { readonly index: number; readonly link: GraphicsLink } | undefined;
  /** The app profile's placement; nothing is placed without one. */
  placement: (thread: ThreadCandidate) => Placement = () => Placement.Cooperative;
  /** The EAGL rendering API and context of the guest thread the main thread runs host calls for. */
  graphicsState: (() => readonly [number, number]) | undefined;
  /** Import gates whose symbols workers answer themselves (`LOCAL_IMPORT_NAMES`). */
  localGates: () => readonly (readonly [number, string])[] = () => [];
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
      executeMs: 0,
      localCalls: 0,
    };
  }
  get graphics(): GraphicsLink | undefined {
    return this.#graphics?.link;
  }
  #placementOf(start: ThreadStart): Placement {
    const placed = configured.place ? configured.place(start) : this.placement(start);
    if (typeof placed !== "boolean") return placed;
    return placed ? Placement.Worker : Placement.Cooperative;
  }
  /** A free worker for `placement`, or -1; the graphics worker only takes graphics threads. */
  #slot(placement: Placement): number {
    const graphics = this.#graphics?.index;
    if (placement === Placement.Graphics)
      return graphics !== undefined && !this.#workers[graphics]?.thread ? graphics : -1;
    let index = this.#workers.findIndex((worker, at) => at !== graphics && !worker?.thread);
    if (index < 0) index = this.#workers.length;
    return index < MaxWorkerThreads ? index : -1;
  }
  /** Starts the thread on a free worker when its placement asks for one; undefined keeps it cooperative. */
  place(start: ThreadStart): RemoteThread | undefined {
    const placement = this.#placementOf(start);
    if (placement === Placement.Cooperative) return undefined;
    const index = this.#slot(placement);
    if (index < 0) return undefined;
    if (placement === Placement.Graphics) this.#graphicsThreads.push(start.id);
    const worker = this.#workers[index] ?? this.#spawn(index),
      base = this.#initialize(index, start),
      channel = new ThreadChannel(this.registry.control);
    const thread = new RemoteThread(
      this.cpu,
      this.registry,
      worker.port,
      channel,
      base,
      () => this.#release(index),
      () => this.graphicsState?.(),
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
      thread: start.id,
      imports: this.localGates(),
      timeOrigin: performance.timeOrigin,
      preempt: this.cpu.layout.budget,
    });
    return thread;
  }
  /** Moves the WebGL context to a worker of its own, which graphics threads then run on. */
  async startGraphics(options: GraphicsOptions): Promise<GraphicsLink> {
    const index = this.#slot(Placement.Worker);
    if (index < 0) throw new Error("No execution worker is free for graphics.");
    const worker = this.#spawn(index),
      { arena, mask } = this.cpu.layout;
    const link = await startGraphics(
      worker.port,
      (handler) => worker.listeners.push(handler),
      { memory: this.memory, control: this.registry.control.buffer, arena, mask },
      options,
      () => {
        const thread = this.#workers[index]?.thread;
        thread?.channel.signal();
        thread?.preempt();
      },
    );
    this.#graphics = { index, link };
    return link;
  }
  /** Answers the GL owner's guest heap requests. */
  serviceGraphics(): void {
    const link = this.#graphics?.link;
    if (link) while (link.serve());
  }
  #spawn(index: number): ExecutionWorker {
    const worker: ExecutionWorker = { port: configured.spawn(), thread: undefined, listeners: [] };
    worker.port.listen((message) => {
      if (isFailedMessage(message)) worker.thread?.listen(message);
      for (const listener of worker.listeners) listener(message);
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
    const { calls, totalMs, maxMs, executeMs, localCalls } = thread.channel.statistics;
    totals.threads++;
    totals.hostCalls += calls;
    totals.roundTripMs += totalMs;
    totals.maxRoundTripMs = Math.max(totals.maxRoundTripMs, maxMs);
    totals.hostMs += thread.hostMs;
    totals.codeRequests += thread.codeRequests;
    totals.executeMs += executeMs;
    totals.localCalls += localCalls;
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
    const graphics = this.#graphics?.link.statistics();
    return {
      ...totals,
      graphicsThreads: [...this.#graphicsThreads],
      ...(graphics ? { graphics } : {}),
    };
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
