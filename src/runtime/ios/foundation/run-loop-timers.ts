import { readString } from "../../memory/guest-memory";
import { doubleBits, doubleFromBits } from "../abi/scalars";
import type { GuestArguments } from "../objc/host";
import type { RunLoopHost } from "./run-loop-host";

const MIN_INTERVAL_MS = 0.1;
const MS_PER_SECOND = 1000;
const Create = { IntervalLow: 0, IntervalHigh: 1, Target: 2, Selector: 3, UserInfo: 4, Repeats: 5 };
const TIMER_CLASS = "NSTimer";

interface Timer {
  target: number;
  readonly name: string;
  userInfo: number;
  readonly repeats: boolean;
  readonly interval: number;
  at: number;
  valid: boolean;
}

export class RunLoopTimers {
  private readonly timers = new Map<number, Timer>();
  readonly scheduled = new Map<number, Timer>();
  constructor(private readonly host: RunLoopHost) {
    host.hostClass(TIMER_CLASS, "NSObject");
    this.install();
  }

  private create(a: GuestArguments, schedule: boolean): number {
    const { host } = this;
    const interval = Math.max(
      MIN_INTERVAL_MS,
      doubleFromBits(a(Create.IntervalLow), a(Create.IntervalHigh)) * MS_PER_SECOND,
    );
    const pointer = host.alloc(this.timerClass());
    const timer: Timer = {
      target: host.retain(a(Create.Target)),
      name: readString(host.cpu, a(Create.Selector)),
      userInfo: host.retain(a(Create.UserInfo)),
      repeats: Boolean(a(Create.Repeats)),
      interval,
      at: performance.now() + interval,
      valid: true,
    };
    this.timers.set(pointer, timer);
    if (schedule) this.scheduled.set(host.retain(pointer), timer);
    return host.autorelease(pointer);
  }

  private timerClass(): number {
    const pointer = this.host.names.get(TIMER_CLASS);
    if (pointer === undefined) throw new Error("Missing host class NSTimer");
    return pointer;
  }

  async invalidate(pointer: number): Promise<void> {
    const timer = this.timers.get(pointer);
    if (!timer?.valid) return;
    timer.valid = false;
    await this.host.release(timer.target);
    await this.host.release(timer.userInfo);
    timer.target = 0;
    timer.userInfo = 0;
    if (this.scheduled.delete(pointer)) await this.host.release(pointer);
  }

  async fire(pointer: number): Promise<void> {
    const timer = this.timers.get(pointer);
    if (!timer?.valid) return;
    timer.at = performance.now() + timer.interval;
    try {
      await this.host.send(timer.target, timer.name, [pointer]);
    } finally {
      if (!timer.repeats) await this.invalidate(pointer);
    }
  }

  async unschedule(pointer: number): Promise<void> {
    if (this.scheduled.delete(pointer)) await this.host.release(pointer);
  }

  async fireDue(now: number): Promise<void> {
    for (const [pointer, timer] of [...this.scheduled])
      if (timer.valid && timer.at <= now) await this.fire(pointer);
  }

  private install(): void {
    const { method, retain, destroy } = this.host;
    method(
      TIMER_CLASS,
      true,
      "scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:",
      (_, a) => this.create(a, true),
    );
    method(TIMER_CLASS, true, "timerWithTimeInterval:target:selector:userInfo:repeats:", (_, a) =>
      this.create(a, false),
    );
    method(TIMER_CLASS, false, "invalidate", (self) => this.invalidate(self));
    method(TIMER_CLASS, false, "fire", (self) => this.fire(self));
    method(TIMER_CLASS, false, "isValid", (self) => Number(this.timers.get(self)?.valid ?? false));
    method(TIMER_CLASS, false, "userInfo", (self) => this.timers.get(self)?.userInfo ?? 0);
    method(TIMER_CLASS, false, "timeInterval", (self) =>
      doubleBits((this.timers.get(self)?.interval ?? 0) / MS_PER_SECOND),
    );
    method(TIMER_CLASS, false, "dealloc", async (self) => {
      await this.invalidate(self);
      this.timers.delete(self);
      destroy(self);
    });
    method("NSRunLoop", false, "addTimer:forMode:", (_, a) => {
      const pointer = a(0),
        timer = this.timers.get(pointer);
      if (timer?.valid && !this.scheduled.has(pointer)) this.scheduled.set(retain(pointer), timer);
    });
  }
}
