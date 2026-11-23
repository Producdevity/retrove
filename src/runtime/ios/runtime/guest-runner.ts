import type { GuestCPU } from "../../cpu/cpu";
import { GuestLandingPad } from "../../cxx/landing-pad";
import { write32 } from "../../memory/guest-memory";
import type { Startup } from "../macho/load";
import type { MachOImage } from "../macho/macho";
import { initialized } from "../objc/runtime-types";
import { registerValue, type Step, type StepResult } from "../threads/thread-types";
import type { GuestThreads } from "../threads/threads";
import type { GuestReport } from "./guest-report";
import { THREAD_TIMING_STRIDE, type HostCalls } from "./host-calls";
import { RETURN, type HostStub } from "./host-gates";

const Register = { Arguments: 4, Sp: 13, Lr: 14, High: 1 } as const;
const WORD_BYTES = 4;
const STACK_ALIGNMENT = 16;
const MIN_NESTED_FRAME = 32;
/** Guest call boundary room below the raw startup stack. */
const BASE_FRAME = 32;
const SLICE_INSTRUCTIONS = 65536;
const SERVICE_INTERVAL_MS = 4;
const YIELD_INTERVAL_MS = 16;
/** Worker time a blocked caller gives runnable threads per wait poll. */
const BLOCKED_SERVICE_MS = 8;
const HIGH_WORD_SHIFT = 32n;

/** Runs guest code on the current thread's stack; `wide` asks for the r1:r0 result. */
export interface RuntimeCall {
  (entry: number, args: readonly number[]): Promise<number>;
  (entry: number, args: readonly number[], wide?: boolean): Promise<number | bigint>;
}

/** The main run loop's per-turn work, once the frameworks behind it exist. */
export interface MainLoop {
  readonly dispatch: { pollMain(): Promise<unknown> };
  readonly sounds: { pump(): Promise<void> };
  readonly queues: { pump(): Promise<void> };
}

/** Drives guest code: CPU slices, host imports at gates, nested calls and cooperative threads. */
export class GuestRunner {
  mainLoop: MainLoop | undefined;
  #startup: Startup | undefined;
  #lastYield = 0;
  #lastService = 0;
  readonly nested: RuntimeCall;
  constructor(
    readonly cpu: GuestCPU,
    readonly threads: GuestThreads,
    private readonly report: GuestReport,
    private readonly calls: HostCalls,
    private readonly stubs: ReadonlyMap<number, HostStub>,
    private readonly image: MachOImage,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.nested = nestedCall(this);
  }
  /** Guest code may run from here on, with `startup`'s stack as the base of every call. */
  begin(startup: Startup): void {
    this.#startup = startup;
    this.#lastYield = performance.now();
    this.#lastService = this.#lastYield;
  }
  get startup(): Startup {
    return initialized(this.#startup, "startup");
  }
  get baseSP(): number {
    return this.startup.rawStack - BASE_FRAME;
  }
  /** Runs guest code at `entry` until it returns to the runtime's return gate. */
  async call(
    entry: number,
    args: readonly number[],
    raw = false,
    sp = this.baseSP,
  ): Promise<number> {
    const { cpu, signal, threads } = this;
    cpu.setReg(Register.Sp, raw ? this.startup.rawStack : sp);
    cpu.setReg(Register.Lr, RETURN);
    for (const [i, arg] of args.entries()) {
      if (i < Register.Arguments) cpu.setReg(i, arg);
      else write32(cpu, sp + (i - Register.Arguments) * WORD_BYTES, arg);
    }
    let pc = entry;
    for (;;) {
      signal?.throwIfAborted();
      try {
        let result = this.step(pc);
        if (result instanceof Promise) result = await result;
        if (!result.done && result.unwind) throw result.unwind;
        if (result.done) return result.value;
        pc = result.pc;
        if (result.wait) await this.#block(result.wait);
        // Worker threads wait on their host calls; answer them at every slice boundary.
        if (threads.remote?.pending()) await threads.serviceRemote();
        if (result.budget || performance.now() - this.#lastService > SERVICE_INTERVAL_MS)
          await this.service();
        if (performance.now() - this.#lastYield > YIELD_INTERVAL_MS) {
          await this.yieldToBrowser();
          this.#lastYield = performance.now();
        }
      } catch (error) {
        // A C++ throw can cross a guest callback invoked from a host import. Pass the transfer
        // back through nested() until its owning stack is active, then restore the registers
        // recorded by the guest compiler.
        if (
          !(error instanceof GuestLandingPad) ||
          error.thread !== threads.funcs._pthread_self() ||
          error.sp > (raw ? this.startup.rawStack : sp)
        )
          throw error;
        pc = error.restore(cpu);
      }
    }
  }
  async #block(wait: () => unknown): Promise<void> {
    for (;;) {
      this.signal?.throwIfAborted();
      const value = wait();
      if (value !== undefined) {
        this.cpu.setReg(0, registerValue(value));
        return;
      }
      // The blocked caller has yielded its CPU to runnable threads.
      await this.service(BLOCKED_SERVICE_MS);
      await this.yieldToBrowser();
    }
  }
  readonly service = async (workerBudgetMs = 0, mainRunLoopTurn = false): Promise<void> => {
    const { threads } = this,
      { parts } = this.report.state;
    this.#lastService = performance.now();
    await threads.advance(this.step, this.nested, workerBudgetMs);
    await parts.audio?.pump();
    if (mainRunLoopTurn && threads.funcs._pthread_main_np()) {
      const { dispatch, sounds, queues } = initialized(this.mainLoop, "dispatch"),
        objc = initialized(parts.objc, "objc"),
        audio = initialized(parts.audio, "audio");
      await dispatch.pollMain();
      await objc.pumpMovies();
      await objc.pumpAlerts();
      await objc.pumpAudioPlayers();
      await audio.pumpSession(objc);
      await sounds.pump();
      await queues.pump();
    }
  };
  async yieldToBrowser(): Promise<void> {
    const { threads } = this;
    const before = performance.now();
    const turn = new Promise<void>((resolve) => setTimeout(resolve, 0));
    await (threads.remote ? threads.idle(turn) : turn);
    this.report.state.yieldMilliseconds += performance.now() - before;
  }
  /** Host imports that return plain values complete without a microtask turn; only promises are awaited. */
  readonly step: Step = (pc) => {
    const { report } = this;
    // Capture before nested guest callbacks and cooperative threads restore their caller's registers.
    try {
      const result = this.#execute(pc);
      return result instanceof Promise
        ? result.catch((error: unknown) => {
            report.captureFault(error);
            throw error;
          })
        : result;
    } catch (error) {
      report.captureFault(error);
      throw error;
    }
  };
  #execute(pc: number): StepResult | Promise<StepResult> {
    const { cpu, threads, calls } = this,
      { state } = this.report;
    state.cpuSlices++;
    if (this.stubs.has(pc)) {
      calls.pending = pc;
      return calls.finishPending();
    }
    let result;
    if (state.cpuSlices % THREAD_TIMING_STRIDE)
      result = cpu.run(pc, { until: RETURN, count: SLICE_INSTRUCTIONS });
    else {
      // One slice in THREAD_TIMING_STRIDE is timed: reading the clock on every slice costs more than the estimate is worth.
      const started = performance.now();
      result = cpu.run(pc, { until: RETURN, count: SLICE_INSTRUCTIONS });
      const thread = threads.funcs._pthread_self();
      state.threadCpuMs.set(
        thread,
        (state.threadCpuMs.get(thread) ?? 0) + (performance.now() - started) * THREAD_TIMING_STRIDE,
      );
    }
    if (result.reason === "until") return { done: true, value: cpu.getReg(0) };
    if (result.reason === "budget") {
      state.budgetSlices++;
      state.executionMetrics.sample(
        threads.funcs._pthread_self(),
        result.pc,
        this.image.symbolAt(result.pc),
      );
      return { pc: result.pc, budget: true };
    }
    return calls.finishPending();
  }
}

/** Calls guest code on the current thread's stack below the caller's frame, then restores the caller. */
function nestedCall(runner: GuestRunner): RuntimeCall {
  function nested(entry: number, args: readonly number[]): Promise<number>;
  function nested(entry: number, args: readonly number[], wide?: boolean): Promise<number | bigint>;
  async function nested(
    entry: number,
    args: readonly number[],
    wide = false,
  ): Promise<number | bigint> {
    const { cpu, threads } = runner;
    const state = cpu.saveState();
    const stack =
      Math.floor(
        (cpu.getReg(Register.Sp) - Math.max(MIN_NESTED_FRAME, args.length * WORD_BYTES)) /
          STACK_ALIGNMENT,
      ) * STACK_ALIGNMENT;
    if (stack < threads.stackBottom) {
      cpu.freeState(state);
      throw Error("Guest stack exhausted");
    }
    try {
      const lo = await runner.call(entry, args, false, stack);
      return wide ? (BigInt(cpu.getReg(Register.High)) << HIGH_WORD_SHIFT) | BigInt(lo) : lo;
    } finally {
      cpu.restoreState(state);
      cpu.freeState(state);
    }
  }
  return nested;
}
