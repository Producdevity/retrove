import type { RemoteThread } from "../../cpu/worker/remote-thread";
import type { WorkerThreads } from "../../cpu/worker/worker-host";
import type { ThreadExits } from "./thread-exit";
import type { ThreadTable } from "./thread-table";
import {
  registerValue,
  type NestedCall,
  type SpawnedThread,
  type Step,
  type StepResult,
  type ThreadCpu,
} from "./thread-types";

// Bounds the service loop when worker threads keep releasing each other.
const SERVICE_PASSES = 8;
export const CROSS_THREAD_EXCEPTION = "Cross-thread C++ exception";
export interface Connection {
  readonly step: Step;
  readonly nested: NestedCall;
}

/**
 * Guest threads on execution workers: their host calls run here, on the main CPU loaded with the
 * thread's registers, exactly as a cooperative thread's would.
 */
export class RemoteService {
  connected: Connection | undefined;
  #servicing = false;
  constructor(
    private readonly cpu: ThreadCpu,
    private readonly table: ThreadTable,
    private readonly exits: ThreadExits,
    readonly remote: WorkerThreads | undefined,
  ) {}
  readonly service = async (): Promise<void> => {
    const { remote, connected } = this;
    // The GL owner's heap requests come from inside one GL call; answer them even mid-service.
    remote?.serviceGraphics();
    if (!remote || !connected || this.#servicing) return;
    this.#servicing = true;
    try {
      // An answered call (a signal, an unlock) can release another worker thread's wait: poll again
      // while anything moved, so that thread does not wait for the next display refresh.
      for (let pass = 0, moved = true; moved && pass < SERVICE_PASSES; pass++) {
        remote.acknowledge();
        moved = false;
        for (const t of [...this.table.workers.values()])
          if (t.remote && !t.done && (await this.#serviceThread(t, t.remote, connected)))
            moved = true;
      }
    } finally {
      this.#servicing = false;
    }
  };
  /** Whether the thread moved: its wait ended or a request was answered. */
  async #serviceThread(
    t: SpawnedThread,
    remote: RemoteThread,
    connected: Connection,
  ): Promise<boolean> {
    const { table, cpu } = this;
    const outer = table.current;
    let moved = false;
    if (t.wait) {
      table.current = t;
      try {
        const value = t.wait();
        if (value === undefined) return false;
        t.wait = undefined;
        remote.resume(t.pc, registerValue(value));
        moved = true;
      } finally {
        table.current = outer;
      }
    }
    const request = remote.take();
    if (!request) return moved;
    const outerState = cpu.saveState();
    table.current = t;
    try {
      remote.enter(request.pc);
      let result: StepResult | Promise<StepResult> = request.exit
        ? { done: true, value: cpu.getReg(0) }
        : connected.step(request.pc);
      if (result instanceof Promise) result = await result;
      if (result.done) {
        await this.exits.finish(t, result.value, connected.nested);
        remote.finish();
        return true;
      }
      if (result.unwind && result.unwind.thread !== t.id) throw Error(CROSS_THREAD_EXCEPTION);
      t.pc = result.unwind ? result.unwind.restore(cpu) : result.pc;
      remote.leave();
      if (result.wait) t.wait = result.wait;
      else remote.resume(t.pc);
      return true;
    } finally {
      table.current = outer;
      cpu.restoreState(outerState);
      cpu.freeState(outerState);
    }
  }
}
