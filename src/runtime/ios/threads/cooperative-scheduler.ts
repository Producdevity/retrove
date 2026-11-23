import { CROSS_THREAD_EXCEPTION, type RemoteService } from "./remote-service";
import { Scheduling } from "./scheduling";
import type { ThreadExits } from "./thread-exit";
import type { ThreadTable } from "./thread-table";
import {
  registerValue,
  type NestedCall,
  type SpawnedThread,
  type Step,
  type ThreadCpu,
} from "./thread-types";

// With block scheduling the turn limit only keeps the page responsive when a thread
// computes for a long time without blocking.
const SLICE_STEPS = 8,
  TURN_LIMIT_MS = 8,
  CLOCK_STRIDE = 32;
const CLEARED_REGISTERS = 13;
const Register = { Sp: 13, Lr: 14 } as const;

/** How the cooperative scheduler ended each thread's turns. */
export interface SchedulerTurns {
  scheduling: Scheduling;
  turns: number;
  blocked: number;
  sliced: number;
  limited: number;
  exited: number;
  budgetSteps: number;
  steps: number;
}

/** Gives each runnable guest-created thread a turn on the main CPU. */
export class CooperativeScheduler {
  readonly turns: SchedulerTurns;
  readonly #blockDriven: boolean;
  constructor(
    private readonly cpu: ThreadCpu,
    private readonly table: ThreadTable,
    private readonly exits: ThreadExits,
    private readonly remote: RemoteService,
    private readonly returnAddress: number,
    scheduling: Scheduling,
  ) {
    this.#blockDriven = scheduling === Scheduling.Blocks;
    this.turns = {
      scheduling,
      turns: 0,
      blocked: 0,
      sliced: 0,
      limited: 0,
      exited: 0,
      budgetSteps: 0,
      steps: 0,
    };
  }
  #ready(): SpawnedThread[] {
    return [...this.table.workers.values()].filter((t) => !t.done && !t.running && !t.remote);
  }
  readonly advance = async (step: Step, nested: NestedCall, budgetMs = 0): Promise<void> => {
    const { cpu, table } = this;
    if (this.remote.remote) await this.remote.service();
    let batch = this.#ready();
    if (!batch.length) return;
    const deadline = performance.now() + budgetMs;
    const outer = table.current,
      outerState = cpu.saveState();
    try {
      // Each runnable thread gets a turn. The idle application loop can spend
      // its remaining time on further rounds without polling blocked threads.
      do {
        let progressed = false;
        for (const t of batch) {
          if (t.done || t.running || !table.workers.has(t.id)) continue;
          if (await this.#turn(t, step, nested)) progressed = true;
        }
        if (!progressed || performance.now() >= deadline) break;
        batch = this.#ready();
      } while (batch.length);
    } finally {
      table.current = outer;
      cpu.restoreState(outerState);
      cpu.freeState(outerState);
    }
  };
  /** Whether the thread ran: false while its wait has no value yet. */
  async #turn(t: SpawnedThread, step: Step, nested: NestedCall): Promise<boolean> {
    const { cpu } = this;
    this.table.current = t;
    t.running = true;
    try {
      if (t.wait) {
        const result = t.wait();
        if (result === undefined) return false;
        t.wait = undefined;
        t.resume = registerValue(result);
      }
      this.#enter(t);
      if (t.resume !== undefined) {
        cpu.setReg(0, t.resume);
        t.resume = undefined;
      }
      this.turns.turns++;
      await this.#slices(t, step, nested);
      if (!t.done) t.state = cpu.saveState();
      return true;
    } finally {
      t.running = false;
    }
  }
  /** Loads the thread's saved registers, or its start routine's on its first turn. */
  #enter(t: SpawnedThread): void {
    const { cpu } = this;
    if (t.state !== undefined) {
      cpu.restoreState(t.state);
      cpu.freeState(t.state);
      t.state = undefined;
      return;
    }
    cpu.threadPointer = t.pointer;
    for (let i = 0; i < CLEARED_REGISTERS; i++) cpu.setReg(i, 0);
    t.args.forEach((value, i) => cpu.setReg(i, value));
    cpu.setReg(Register.Sp, t.sp);
    cpu.setReg(Register.Lr, this.returnAddress);
  }
  async #slices(t: SpawnedThread, step: Step, nested: NestedCall): Promise<void> {
    const { turns, cpu } = this;
    const turnEnd = this.#blockDriven ? performance.now() + TURN_LIMIT_MS : 0;
    for (let i = 1; ; i++) {
      const pending = step(t.pc);
      const result = pending instanceof Promise ? await pending : pending;
      turns.steps++;
      if (result.done) {
        turns.exited++;
        await this.exits.finish(t, result.value, nested);
        return;
      }
      if (result.unwind && result.unwind.thread !== t.id) throw Error(CROSS_THREAD_EXCEPTION);
      t.pc = result.unwind ? result.unwind.restore(cpu) : result.pc;
      t.wait = result.wait;
      // Worker threads wait on their host calls; answer them between this thread's slices.
      if (this.remote.remote?.pending()) await this.remote.service();
      if (result.wait) {
        turns.blocked++;
        return;
      }
      if (result.budget) turns.budgetSteps++;
      if (!this.#blockDriven) {
        if (result.budget || i >= SLICE_STEPS) {
          turns.sliced++;
          return;
        }
      } else if ((result.budget || i % CLOCK_STRIDE === 0) && performance.now() >= turnEnd) {
        turns.limited++;
        return;
      }
    }
  }
}
