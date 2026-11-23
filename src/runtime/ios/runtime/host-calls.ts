import type { GuestCPU } from "../../cpu/cpu";
import { GuestLandingPad } from "../../cxx/landing-pad";
import { read32 } from "../../memory/guest-memory";
import { registerValue, type StepResult, type WaitPoll } from "../threads/thread-types";
import type { GuestThreads } from "../threads/threads";
import { GuestExit } from "./fault";
import type { GuestReport } from "./guest-report";
import type { HostStub } from "./host-gates";
import { hex, label } from "./snapshot";

const Register = { Arguments: 4, Sp: 13, Lr: 14, High: 1 } as const;
const WORD_BYTES = 4;
const RECENT_IMPORTS = 12;
const HIGH_WORD_SHIFT = 32n;
const LOW_WORD = 0xffffffffn;
/** One in-place import in this many is timed; reading the clock on every call costs more than the estimate is worth. */
export const THREAD_TIMING_STRIDE = 64;

interface CallSite {
  readonly host: HostStub;
  readonly symbol: string;
  readonly gate: number;
  readonly lr: number;
  readonly graphicsStarted: number;
  readonly graphicsCpuStarted: number;
}
interface StartedCall {
  readonly site: CallSite;
  readonly value: unknown;
  readonly failed: boolean;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const then: unknown = Reflect.get(value, "then");
  return typeof then === "function";
}

function isPoll(value: unknown): value is WaitPoll {
  return typeof value === "function";
}

/** Runs host imports at their gates and turns their results into the guest's next step. */
export class HostCalls {
  /** The gate the last trap stopped at. */
  pending = 0;
  /** An import translated code started in place but that did not complete there; the runner finishes it. */
  #deferred: StartedCall | undefined;
  #count = 0;
  constructor(
    private readonly cpu: GuestCPU,
    private readonly threads: GuestThreads,
    private readonly stubs: ReadonlyMap<number, HostStub>,
    private readonly report: GuestReport,
  ) {}
  /** Completes the import at the pending gate, or the one translated code deferred there. */
  finishPending(): StepResult | Promise<StepResult> {
    const gate = this.pending;
    let started = this.#deferred;
    this.#deferred = undefined;
    if (started?.site.gate !== gate) started = this.#start(gate);
    return this.#finish(started);
  }
  /**
   * Called from translated code at an import gate with its frames still live: plain results
   * continue there; anything else (a wait, promise, exception or transfer) is finished by the runner.
   */
  readonly hostInPlace = (gate: number): number | undefined => {
    if (!this.stubs.has(gate)) return undefined;
    const timed = ++this.#count % THREAD_TIMING_STRIDE === 0,
      begun = timed ? performance.now() : 0;
    try {
      const started = this.#start(gate),
        value = started.value;
      if (
        started.failed ||
        (value !== null && (typeof value === "object" || typeof value === "function"))
      ) {
        this.#deferred = started;
        return undefined;
      }
      this.#account(started.site, value, false);
      this.#store(value);
      return started.site.lr;
    } finally {
      if (timed)
        this.report.state.inPlaceMilliseconds += (performance.now() - begun) * THREAD_TIMING_STRIDE;
    }
  };
  #start(gate: number): StartedCall {
    const { cpu, report } = this,
      { state } = report;
    const host = this.stubs.get(gate);
    if (!host) throw Error("Invalid import gate " + hex(gate));
    const lr = cpu.getReg(Register.Lr);
    const symbol = (host.symbol ??= label(host.binding.name));
    const thread = this.threads.funcs._pthread_self(),
      { lastCall, recent } = state;
    // Formatted only when the call site changes: imports run hundreds of thousands of times a second.
    if (gate !== lastCall.gate || lr !== lastCall.lr || thread !== lastCall.thread) {
      lastCall.gate = gate;
      lastCall.lr = lr;
      lastCall.thread = thread;
      recent.push(symbol + " ← " + hex(lr) + " (thread " + thread + ")");
      if (recent.length > RECENT_IMPORTS) recent.shift();
    }
    if (!host.fn)
      throw Error(
        "Missing import " +
          symbol +
          " from " +
          (host.binding.library || "flat namespace") +
          " (guest LR " +
          hex(lr) +
          ")",
      );
    state.calls++;
    host.counter.calls++;
    const arg = (n: number) =>
      n < Register.Arguments
        ? cpu.getReg(n)
        : read32(cpu, cpu.getReg(Register.Sp) + (n - Register.Arguments) * WORD_BYTES);
    state.active.push({ name: symbol, thread });
    const site: CallSite = {
      host,
      symbol,
      gate,
      lr,
      graphicsStarted: host.graphics ? performance.now() : 0,
      graphicsCpuStarted: host.graphics ? state.guestMilliseconds() : 0,
    };
    try {
      return { site, value: host.fn(arg), failed: false };
    } catch (error) {
      return { site, value: error, failed: true };
    }
  }
  #finish({ site, value, failed }: StartedCall): StepResult | Promise<StepResult> {
    if (failed) return this.#settle(site, value, true);
    if (isThenable(value))
      return Promise.resolve(value).then(
        (resolved) => this.#settle(site, resolved, false),
        (error: unknown) => this.#settle(site, error, true),
      );
    return this.#settle(site, value, false);
  }
  #settle(site: CallSite, value: unknown, failed: boolean): StepResult {
    this.#account(site, value, failed);
    if (typeof value === "object" && value !== null) {
      if (value instanceof GuestLandingPad) return { pc: value.pc, unwind: value };
      if ("exit" in value) throw new GuestExit(registerValue(value.exit));
      if ("threadExit" in value) return { done: true, value: registerValue(value.threadExit) };
      // A resumed import re-enters through its gate with r0 set to the wait's value.
      if ("wait" in value) {
        const wait: unknown = value.wait;
        if (wait !== undefined && !isPoll(wait)) throw Error("Invalid host call result");
        const again: unknown = Reflect.get(value, "again");
        return { pc: again ? site.gate : site.lr, wait };
      }
      if ("jump" in value) return { pc: registerValue(value.jump) };
      throw Error("Invalid host call result");
    }
    this.#store(value);
    return { pc: site.lr };
  }
  /** Closes the call's bookkeeping; a failure other than a C++ transfer is the run's fault. */
  #account(site: CallSite, value: unknown, failed: boolean): void {
    const { report } = this,
      { state } = report;
    try {
      if (failed && !(value instanceof GuestLandingPad)) {
        report.captureFault(value);
        throw value;
      }
    } finally {
      if (site.host.graphics) {
        const duration = Math.max(
          0,
          performance.now() -
            site.graphicsStarted -
            (state.guestMilliseconds() - site.graphicsCpuStarted),
        );
        state.graphicsMilliseconds += duration;
        state.graphicsMetrics.record(site.symbol, duration);
      }
      state.active.pop();
    }
    if (site.symbol === "_glClear") {
      state.render.clearCalls++;
      report.onRender();
    } else if (site.symbol === "_glDrawArrays" || site.symbol === "_glDrawElements") {
      state.render.drawCalls++;
      report.onRender();
    }
  }
  /** A plain result goes into r0, or r0 and r1 for a 64-bit one. */
  #store(value: unknown): void {
    const { cpu } = this;
    if (typeof value === "bigint") {
      cpu.setReg(0, Number(value & LOW_WORD));
      cpu.setReg(Register.High, Number((value >> HIGH_WORD_SHIFT) & LOW_WORD));
    } else if (value !== undefined) cpu.setReg(0, registerValue(value));
  }
}
