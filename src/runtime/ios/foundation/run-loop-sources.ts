import { WORD_BYTES } from "../abi/scalars";
import { Argument, type FoundationHost } from "../objc/host";
import { RunLoopMode } from "./ports";

/** CFRunLoopRunInMode results. */
export const RunLoopResult = { Finished: 1, Stopped: 2, TimedOut: 3, HandledSource: 4 } as const;
/** Word offsets in CFRunLoopSourceContext version 0. */
const Context = { Version: 0, Info: 1, Retain: 2, Release: 3, Schedule: 7, Cancel: 8, Perform: 9 };
const SOURCE_CLASS = "__CFRunLoopSource";
/** CFRunLoopRunInMode registers: the double occupies r1:r2 under the iOS APCS ABI. */
const RunArgument = { Mode: 0, SecondsLow: 1, SecondsHigh: 2, ReturnAfterSource: 3 } as const;
const MILLISECONDS_PER_SECOND = 1000;
const DOUBLE_BYTES = 8;
/** Modes that kCFRunLoopCommonModes covers by default. */
const COMMON_MODES = [RunLoopMode.Default, "UITrackingRunLoopMode"];

export interface RunLoopSourceHost extends FoundationHost {
  read(address: number): number;
  callGuest(fn: number, args: number[]): Promise<number>;
  currentLoop(): number;
  /** Delivers queued thread performs and connection events; true when anything ran. */
  poll(loop: number, mode: string): Promise<boolean>;
  /** Whether queued thread performs or connection events are waiting. */
  pending(loop: number, mode: string): boolean;
  /** Whether a port keeps the loop alive in this mode. */
  hasPort(loop: number, mode: string): boolean;
  addTimer(loop: number, timer: number, mode: number): Promise<void>;
  removeTimer(timer: number): Promise<void>;
}
interface Source {
  readonly order: number;
  readonly info: number;
  readonly release: number;
  readonly schedule: number;
  readonly cancel: number;
  readonly perform: number;
  /** Host-owned sources run JavaScript instead of a guest callback. */
  readonly run?: () => Promise<void>;
  signaled: boolean;
  valid: boolean;
  /** Registration key to the mode string the guest passed. */
  readonly registrations: Map<string, number>;
}
interface LoopState {
  stopped: boolean;
  woken: boolean;
}
interface Run {
  readonly loop: number;
  readonly mode: string;
  readonly deadline: number;
  readonly once: boolean;
  resuming: boolean;
}
type Arguments = (index: number) => number;
type WaitResult = number | { again: true; wait(): number | undefined };

function key(loop: number, mode: string): string {
  return `${loop}:${mode}`;
}
function expand(mode: string): readonly string[] {
  return mode === RunLoopMode.Common ? COMMON_MODES : [mode];
}
function seconds(low: number, high: number): number {
  const view = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  view.setUint32(0, low, true);
  view.setUint32(WORD_BYTES, high, true);
  return view.getFloat64(0, true);
}

/** CFRunLoopSource version 0 and the CFRunLoop run, stop and wake functions. */
export class RunLoopSources {
  private readonly sources = new Map<number, Source>();
  private readonly loops = new Map<number, LoopState>();
  private readonly runs = new Map<number, Run>();
  private readonly klass: number;
  constructor(private readonly host: RunLoopSourceHost) {
    this.klass = host.hostClass(SOURCE_CLASS, "NSObject");
    host.method(SOURCE_CLASS, false, "dealloc", async (self) => {
      await this.invalidate(self);
      const source = this.sources.get(self);
      this.sources.delete(self);
      if (source?.release) await host.callGuest(source.release, [source.info]);
      host.destroy(self);
    });
  }
  private loop(pointer: number): LoopState {
    let state = this.loops.get(pointer);
    if (!state) {
      state = { stopped: false, woken: false };
      this.loops.set(pointer, state);
    }
    return state;
  }
  async create(order: number, context: number): Promise<number> {
    if (!context) return 0;
    const word = (index: number): number => this.host.read(context + index * WORD_BYTES);
    if (word(Context.Version) !== 0)
      throw new Error("Only version 0 CFRunLoopSource contexts are supported.");
    const retain = word(Context.Retain),
      info = retain ? await this.host.callGuest(retain, [word(Context.Info)]) : word(Context.Info),
      pointer = this.host.alloc(this.klass);
    this.sources.set(pointer, {
      order,
      info,
      release: word(Context.Release),
      schedule: word(Context.Schedule),
      cancel: word(Context.Cancel),
      perform: word(Context.Perform),
      signaled: false,
      valid: true,
      registrations: new Map(),
    });
    return pointer;
  }
  /** A source whose perform runs host code; the caller owns the returned reference. */
  createHost(run: () => Promise<void>): number {
    const pointer = this.host.alloc(this.klass);
    this.sources.set(pointer, {
      order: 0,
      info: 0,
      release: 0,
      schedule: 0,
      cancel: 0,
      perform: 0,
      run,
      signaled: false,
      valid: true,
      registrations: new Map(),
    });
    return pointer;
  }
  private async fire(source: Source): Promise<void> {
    if (source.run) await source.run();
    else if (source.perform) await this.host.callGuest(source.perform, [source.info]);
  }
  async add(loop: number, pointer: number, mode: number): Promise<void> {
    const source = this.sources.get(pointer);
    if (!source?.valid) return;
    for (const name of expand(this.host.text(mode))) {
      const entry = key(loop, name);
      if (source.registrations.has(entry)) continue;
      source.registrations.set(entry, mode);
      if (source.schedule) await this.host.callGuest(source.schedule, [source.info, loop, mode]);
    }
  }
  async remove(loop: number, pointer: number, mode: number): Promise<void> {
    const source = this.sources.get(pointer);
    if (!source) return;
    for (const name of expand(this.host.text(mode))) {
      if (!source.registrations.delete(key(loop, name))) continue;
      if (source.cancel) await this.host.callGuest(source.cancel, [source.info, loop, mode]);
    }
  }
  async invalidate(pointer: number): Promise<void> {
    const source = this.sources.get(pointer);
    if (!source?.valid) return;
    source.valid = false;
    const entries = [...source.registrations];
    source.registrations.clear();
    for (const [entry, mode] of entries)
      if (source.cancel)
        await this.host.callGuest(source.cancel, [
          source.info,
          Number(entry.slice(0, entry.indexOf(":"))),
          mode,
        ]);
  }
  signal(pointer: number): void {
    const source = this.sources.get(pointer);
    if (source?.valid) source.signaled = true;
  }
  isSignaled(pointer: number): number {
    return Number(this.sources.get(pointer)?.signaled ?? false);
  }
  stop(loop: number): void {
    this.loop(loop).stopped = true;
  }
  wake(loop: number): void {
    this.loop(loop).woken = true;
  }
  private registered(loop: number, mode: string): Source[] {
    const entry = key(loop, mode);
    return [...this.sources.values()]
      .filter((source) => source.valid && source.registrations.has(entry))
      .toSorted((left, right) => left.order - right.order);
  }
  private ready(run: Run): boolean {
    const state = this.loop(run.loop);
    return (
      state.stopped ||
      state.woken ||
      Date.now() >= run.deadline ||
      this.host.pending(run.loop, run.mode) ||
      this.registered(run.loop, run.mode).some((source) => source.signaled)
    );
  }
  private async service(run: Run): Promise<boolean> {
    let handled = await this.host.poll(run.loop, run.mode);
    for (const source of this.registered(run.loop, run.mode)) {
      if (!source.signaled) continue;
      source.signaled = false;
      await this.fire(source);
      handled = true;
      if (run.once) break;
    }
    return handled;
  }
  /** Whether a valid source is registered; used by -[NSRunLoop runMode:beforeDate:]. */
  has(loop: number, mode: string): boolean {
    return this.registered(loop, mode).length > 0;
  }
  signaled(loop: number, mode: string): boolean {
    return this.registered(loop, mode).some((source) => source.signaled);
  }
  async perform(loop: number, mode: string): Promise<boolean> {
    let handled = false;
    for (const source of this.registered(loop, mode)) {
      if (!source.signaled) continue;
      source.signaled = false;
      await this.fire(source);
      handled = true;
    }
    return handled;
  }
  private alive(run: Run): boolean {
    return this.registered(run.loop, run.mode).length > 0 || this.host.hasPort(run.loop, run.mode);
  }
  /** Runs one turn; waits re-enter through the import gate with r0 restored to `resume`. */
  async run(
    thread: number,
    resume: number,
    start: () => Omit<Run, "resuming">,
  ): Promise<WaitResult> {
    const previous = this.runs.get(thread),
      run = previous?.resuming ? previous : { ...start(), resuming: false };
    this.runs.set(thread, run);
    run.resuming = false;
    const state = this.loop(run.loop);
    state.woken = false;
    const finish = (result: number): number => {
      this.runs.delete(thread);
      return result;
    };
    if (state.stopped) {
      state.stopped = false;
      return finish(RunLoopResult.Stopped);
    }
    const handled = await this.service(run);
    if (handled && run.once) return finish(RunLoopResult.HandledSource);
    if (!this.alive(run)) return finish(RunLoopResult.Finished);
    if (Date.now() >= run.deadline) return finish(RunLoopResult.TimedOut);
    run.resuming = true;
    this.runs.set(thread, run);
    return { again: true, wait: () => (this.ready(run) ? resume : undefined) };
  }
  runInMode(thread: number, args: Arguments): Promise<WaitResult> {
    return this.run(thread, args(RunArgument.Mode), () => {
      const duration =
        seconds(args(RunArgument.SecondsLow), args(RunArgument.SecondsHigh)) *
        MILLISECONDS_PER_SECOND;
      return {
        loop: this.host.currentLoop(),
        mode: this.host.text(args(RunArgument.Mode)),
        deadline: Date.now() + (Number.isFinite(duration) ? Math.max(0, duration) : Infinity),
        once: Boolean(args(RunArgument.ReturnAfterSource)),
      };
    });
  }
  /** CFRunLoopRun repeats default-mode turns until the loop stops or has nothing to run. */
  async runDefault(thread: number): Promise<number | { again: true; wait(): number | undefined }> {
    const result = await this.run(thread, 0, () => ({
      loop: this.host.currentLoop(),
      mode: RunLoopMode.Default,
      deadline: Infinity,
      once: false,
    }));
    return typeof result === "number" ? 0 : result;
  }
  addTimer(loop: number, timer: number, mode: number): Promise<void> {
    return this.host.addTimer(loop, timer, mode);
  }
  removeTimer(timer: number): Promise<void> {
    return this.host.removeTimer(timer);
  }
}

export function runLoopSourceFunctions(
  sources: RunLoopSources,
  currentThread: () => number,
): Record<string, (args: Arguments) => unknown> {
  return {
    _CFRunLoopSourceCreate: (a) => sources.create(a(Argument.Second), a(Argument.Third)),
    _CFRunLoopSourceSignal: (a) => {
      sources.signal(a(Argument.First));
    },
    _CFRunLoopSourceIsSignalled: (a) => sources.isSignaled(a(Argument.First)),
    _CFRunLoopSourceInvalidate: (a) => sources.invalidate(a(Argument.First)),
    _CFRunLoopAddSource: (a) =>
      sources.add(a(Argument.First), a(Argument.Second), a(Argument.Third)),
    _CFRunLoopRemoveSource: (a) =>
      sources.remove(a(Argument.First), a(Argument.Second), a(Argument.Third)),
    _CFRunLoopAddTimer: (a) =>
      sources.addTimer(a(Argument.First), a(Argument.Second), a(Argument.Third)),
    _CFRunLoopRemoveTimer: (a) => sources.removeTimer(a(Argument.Second)),
    _CFRunLoopStop: (a) => {
      sources.stop(a(Argument.First));
    },
    _CFRunLoopWakeUp: (a) => {
      sources.wake(a(Argument.First));
    },
    _CFRunLoopRunInMode: (a) => sources.runInMode(currentThread(), a),
    _CFRunLoopRun: () => sources.runDefault(currentThread()),
  };
}
