import { readString } from "../../memory/guest-memory";
import { doubleFromBits } from "../abi/scalars";
import type { GuestArguments, HostResult } from "../objc/host";
import type { QueuedCall, RunLoopHost, SelectorCall } from "./run-loop-host";
import { ThreadDeliveries } from "./thread-delivery";

const MS_PER_SECOND = 1000;
const MAIN_THREAD = 1;
const PERFORM_SELECTORS = [
  { name: "performSelector:", count: 0 },
  { name: "performSelector:withObject:", count: 1 },
  { name: "performSelector:withObject:withObject:", count: 2 },
];
const Perform = { Selector: 0, Object: 1 } as const;
const Delay = { Selector: 0, Object: 1, DelayLow: 2, DelayHigh: 3 } as const;
const OnThread = { Selector: 0, Thread: 1, Object: 2, Wait: 3 } as const;
const MainThread = { Selector: 0, Object: 1, Wait: 2 } as const;
const Cancel = { Target: 0, Selector: 1, Object: 2 } as const;

const isSelectorCall = (call: QueuedCall): call is SelectorCall => "target" in call;

export class SelectorQueue {
  readonly calls: QueuedCall[] = [];
  private readonly deliveries: ThreadDeliveries;
  constructor(private readonly host: RunLoopHost) {
    this.deliveries = new ThreadDeliveries({
      retain: host.retain,
      release: host.release,
      send: host.send,
      currentThread: () => this.currentThread(),
    });
    this.install();
  }

  private currentThread(): number {
    return this.host.threads?.funcs._pthread_self() ?? MAIN_THREAD;
  }

  private deliver(
    target: number,
    selector: number,
    arg: number,
    wait: number,
  ): Promise<HostResult> | { wait(): number | undefined } | undefined {
    const { host } = this;
    const name = readString(host.cpu, selector);
    if (wait && this.currentThread() === MAIN_THREAD) return host.send(target, name, [arg]);
    const call: SelectorCall = {
      target: host.retain(target),
      name,
      arg: host.retain(arg),
      at: 0,
      done: false,
    };
    this.calls.push(call);
    return wait ? { wait: () => (call.done ? 0 : undefined) } : undefined;
  }

  private async cancelDelayed(
    target: number,
    matches: (call: SelectorCall) => Promise<boolean> | boolean,
  ): Promise<void> {
    for (const call of this.calls.slice()) {
      if (
        !isSelectorCall(call) ||
        !call.delayed ||
        call.target !== target ||
        !(await matches(call))
      )
        continue;
      this.calls.splice(this.calls.indexOf(call), 1);
      await this.host.release(call.target);
      await this.host.release(call.arg);
    }
  }

  private install(): void {
    const { host } = this;
    for (const isMeta of [false, true]) {
      for (const { name, count } of PERFORM_SELECTORS)
        host.method("NSObject", isMeta, name, (self, a) =>
          host.send(
            self,
            readString(host.cpu, a(Perform.Selector)),
            Array.from({ length: count }, (_, index) => a(index + Perform.Object)),
          ),
        );
      host.method("NSObject", isMeta, "performSelector:withObject:afterDelay:", (self, a) => {
        this.calls.push({
          target: host.retain(self),
          name: readString(host.cpu, a(Delay.Selector)),
          arg: host.retain(a(Delay.Object)),
          at:
            performance.now() +
            MS_PER_SECOND * doubleFromBits(a(Delay.DelayLow), a(Delay.DelayHigh)),
          delayed: true,
        });
      });
      host.method(
        "NSObject",
        isMeta,
        "performSelectorOnMainThread:withObject:waitUntilDone:",
        (self, a) =>
          this.deliver(self, a(MainThread.Selector), a(MainThread.Object), a(MainThread.Wait)),
      );
      host.method(
        "NSObject",
        isMeta,
        "performSelector:onThread:withObject:waitUntilDone:",
        (self, a) => this.performOnThread(self, a),
      );
    }
    host.method("NSObject", true, "cancelPreviousPerformRequestsWithTarget:", (_, a) =>
      this.cancelDelayed(a(Cancel.Target), () => true),
    );
    host.method(
      "NSObject",
      true,
      "cancelPreviousPerformRequestsWithTarget:selector:object:",
      (_, a) => {
        const name = readString(host.cpu, a(Cancel.Selector)),
          arg = a(Cancel.Object);
        return this.cancelDelayed(
          a(Cancel.Target),
          async (call) =>
            call.name === name &&
            (call.arg === arg ||
              (!!call.arg && !!arg && !!(await host.send(call.arg, "isEqual:", [arg])))),
        );
      },
    );
  }

  private async performOnThread(self: number, a: GuestArguments): Promise<HostResult> {
    const { host } = this;
    const [selector, thread, arg, wait] = [
      a(OnThread.Selector),
      a(OnThread.Thread),
      a(OnThread.Object),
      a(OnThread.Wait),
    ];
    if (await host.send(thread, "isMainThread")) return this.deliver(self, selector, arg, wait);
    return this.deliveries.deliver(
      host.threadIdentity(thread),
      self,
      readString(host.cpu, selector),
      arg,
      Boolean(wait),
    );
  }

  pollThread(id: number, mode: string): Promise<boolean> {
    return this.deliveries.pump(id, mode);
  }

  hasThreadSource(id: number, mode: string): boolean {
    return this.deliveries.pending(id, mode);
  }

  async pumpDue(now: number): Promise<void> {
    const { host } = this;
    for (const call of this.calls.slice()) {
      if (call.at > now) continue;
      this.calls.splice(this.calls.indexOf(call), 1);
      if (!isSelectorCall(call)) {
        await call.run();
        continue;
      }
      try {
        await host.send(call.target, call.name, [call.arg]);
      } finally {
        await host.release(call.target);
        await host.release(call.arg);
        call.done = true;
      }
    }
  }
}
