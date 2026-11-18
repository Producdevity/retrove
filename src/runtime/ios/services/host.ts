import type { FoundationHost, HostResult } from "../objc/host";

/** What the offline service classes need from the runtime. */
export interface ServiceHost extends FoundationHost {
  /** Sends a message; with `optional`, skips receivers that do not respond. */
  send(
    self: number,
    selector: string,
    arguments_?: number[],
    optional?: boolean,
  ): Promise<HostResult>;
  later(task: () => Promise<void>): void;
  /** An autoreleased NSError. */
  error(code: number, domain: string): number;
}

/** Tells a weak delegate about a failure on the next run loop turn, if it still listens. */
export function failLater(
  host: ServiceHost,
  delegate: () => number,
  selector: string,
  leading: number[],
  error: () => number,
): void {
  host.later(async () => {
    const target = delegate();
    if (target) await host.send(target, selector, [...leading, error()], true);
  });
}

/** Installs a getter and setter pair for a weak delegate stored per instance. */
export function delegateAccessors(
  host: ServiceHost,
  className: string,
  delegates: Map<number, number>,
  name = "delegate",
): void {
  const setter = `set${name[0]?.toUpperCase() ?? ""}${name.slice(1)}:`;
  host.method(className, false, name, (self) => delegates.get(self) ?? 0);
  host.method(className, false, setter, (self, args) => {
    if (args(0)) delegates.set(self, args(0));
    else delegates.delete(self);
  });
}
