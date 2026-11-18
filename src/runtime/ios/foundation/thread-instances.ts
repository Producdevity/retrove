import { Argument, type FoundationHost, type HostResult } from "../objc/host";
const CLASS = "NSThread";
interface State {
  state: "new" | "executing" | "finished";
  cancelled: boolean;
  target: number;
  selector: string;
  argument: number;
}
/** A guest method the worker starts in directly, so its waits yield to every other thread. */
export interface ThreadEntry {
  readonly receiver: number;
  readonly selector: string;
  readonly args: readonly number[];
}
interface ThreadHost extends FoundationHost {
  selector(pointer: number): string;
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
  /** Whether the receiver's implementation of `selector` is guest code. */
  guestMethod(receiver: number, selector: string): boolean;
  spawn(
    self: number,
    entry: ThreadEntry | undefined,
    task: () => Promise<void>,
    exited: () => Promise<void>,
  ): void;
}
export function installThreadInstances(host: ThreadHost) {
  const entry = (self: number, value: State): ThreadEntry | undefined => {
    if (value.cancelled) return undefined;
    if (host.guestMethod(self, "main")) return { receiver: self, selector: "main", args: [] };
    return value.target && host.guestMethod(value.target, value.selector)
      ? { receiver: value.target, selector: value.selector, args: [value.argument] }
      : undefined;
  };
  const states = new Map<number, State>();
  const get = (self: number): State => {
    let value = states.get(self);
    if (!value) {
      value = { state: "new", cancelled: false, target: 0, selector: "", argument: 0 };
      states.set(self, value);
    }
    return value;
  };
  host.method(CLASS, false, "initWithTarget:selector:object:", (self, args) => {
    const value = get(self);
    if (value.state !== "new" || value.target) throw new Error("NSThread is already initialized.");
    if (!args(Argument.Second)) throw new Error("NSThread requires a selector.");
    value.target = host.retain(args(Argument.First));
    value.selector = host.selector(args(Argument.Second));
    value.argument = host.retain(args(Argument.Third));
    return self;
  });
  host.method(CLASS, false, "main", async (self) => {
    const value = get(self);
    if (value.target) await host.send(value.target, value.selector, [value.argument]);
  });
  host.method(CLASS, false, "start", async (self) => {
    const value = get(self);
    if (value.state !== "new") throw new Error("NSThread can only be started once.");
    value.state = "executing";
    host.retain(self);
    try {
      host.spawn(
        self,
        entry(self, value),
        async () => {
          if (!value.cancelled) await host.send(self, "main");
        },
        async () => {
          value.state = "finished";
          await host.release(self);
        },
      );
    } catch (error) {
      value.state = "new";
      await host.release(self);
      throw error;
    }
  });
  host.method(CLASS, false, "cancel", (self) => {
    get(self).cancelled = true;
  });
  host.method(CLASS, false, "isCancelled", (self) => Number(get(self).cancelled));
  host.method(CLASS, false, "isExecuting", (self) => Number(get(self).state === "executing"));
  host.method(CLASS, false, "isFinished", (self) => Number(get(self).state === "finished"));
  host.method(CLASS, false, "dealloc", async (self) => {
    const value = states.get(self);
    states.delete(self);
    if (value) {
      await host.release(value.target);
      await host.release(value.argument);
    }
    host.destroy(self);
  });
  return {
    register: (self: number) => {
      if (!states.has(self)) get(self).state = "executing";
    },
  };
}
