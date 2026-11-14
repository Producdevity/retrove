import { doubleBits, doubleFromBits } from "../../abi/scalars";
import type { FoundationHost } from "../../objc/host";
const TRANSACTION_CLASS = "CATransaction";
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_DURATION = 0.25;
const DEFAULT_CURVE = "ease-in-out";
interface Transaction {
  duration: number;
  disabled: boolean;
}
interface TransactionHost extends Pick<FoundationHost, "hostClass" | "method"> {
  thread(): number;
  now(): number;
}
export function installTransactions(host: TransactionHost) {
  const stacks = new Map<number, Transaction[]>(),
    implicit = new Map<number, Transaction>();
  const current = () => {
    const thread = host.thread(),
      explicit = stacks.get(thread)?.at(-1);
    if (explicit) return explicit;
    let value = implicit.get(thread);
    if (!value) {
      value = { duration: DEFAULT_DURATION, disabled: false };
      implicit.set(thread, value);
    }
    return value;
  };
  host.hostClass(TRANSACTION_CLASS, "NSObject");
  host.method(TRANSACTION_CLASS, true, "begin", () => {
    const state = { ...current() },
      thread = host.thread();
    let stack = stacks.get(thread);
    if (!stack) {
      stack = [];
      stacks.set(thread, stack);
    }
    stack.push(state);
  });
  host.method(TRANSACTION_CLASS, true, "commit", () => {
    const thread = host.thread(),
      stack = stacks.get(thread);
    if (stack?.length) {
      stack.pop();
      if (!stack.length) stacks.delete(thread);
    } else implicit.delete(thread);
  });
  host.method(TRANSACTION_CLASS, true, "flush", () => {
    implicit.clear();
  });
  host.method(TRANSACTION_CLASS, true, "animationDuration", () => doubleBits(current().duration));
  host.method(TRANSACTION_CLASS, true, "setAnimationDuration:", (_, args) => {
    const value = doubleFromBits(args(0), args(1));
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid Core Animation duration.");
    current().duration = value;
  });
  host.method(TRANSACTION_CLASS, true, "disableActions", () => Number(current().disabled));
  host.method(TRANSACTION_CLASS, true, "setDisableActions:", (_, args) => {
    current().disabled = Boolean(args(0));
  });
  return {
    context() {
      const value = current();
      return value.disabled
        ? undefined
        : { duration: value.duration, delay: 0, curve: DEFAULT_CURVE, start: host.now() };
    },
    flush() {
      implicit.clear();
    },
  };
}

export function currentMediaTime(now = performance.now()): bigint {
  return doubleBits(now / MILLISECONDS_PER_SECOND);
}
