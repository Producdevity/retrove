import { Argument, type FoundationHost, type GuestArguments, type HostResult } from "../objc/host";
import { WORD_BYTES } from "../abi/scalars";
import { GuestMutexes, MutexError, MutexLayout, MutexType, type MutexWait } from "../threads/mutex";

const SECONDS_TO_MILLISECONDS = 1000;
interface LockHost extends FoundationHost {
  read(address: number): number;
  currentThread(): number;
  send(self: number, selector: string): Promise<HostResult>;
  waitMethod(
    name: string,
    selector: string,
    implementation: (
      self: number,
      args: GuestArguments,
    ) => number | MutexWait | Promise<number | MutexWait>,
  ): void;
}
function successful(result: number) {
  if (result !== 0) throw Error("Foundation lock operation failed: " + result);
  return 0;
}
export function installLocks(host: LockHost) {
  const mutexes = new GuestMutexes(host),
    names = new Map<number, string>();
  for (const [name, type] of [
    ["NSLock", MutexType.Normal],
    ["NSRecursiveLock", MutexType.Recursive],
  ] as const) {
    host.hostClass(name, "NSObject", WORD_BYTES + MutexLayout.Bytes);
    host.method(name, false, "init", (self) => {
      successful(mutexes.initialize(self + WORD_BYTES, type));
      return self;
    });
    host.waitMethod(name, "lock", (self) => {
      const result = mutexes.lock(self + WORD_BYTES, host.currentThread(), false);
      if (typeof result === "number") return successful(result);
      return {
        wait() {
          const value = result.wait();
          return value === undefined ? undefined : successful(value);
        },
      };
    });
    host.method(name, false, "tryLock", (self) => {
      const result = mutexes.take(self + WORD_BYTES, host.currentThread());
      return result === undefined ? 0 : Number(successful(result) === 0);
    });
    host.method(name, false, "unlock", (self) =>
      successful(mutexes.unlock(self + WORD_BYTES, host.currentThread())),
    );
    host.waitMethod(name, "lockBeforeDate:", async (self, args) => {
      const thread = host.currentThread();
      const result = await host.send(args(Argument.First), "timeIntervalSince1970");
      if (typeof result !== "bigint") throw Error("Invalid Foundation lock deadline");
      const bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
      bits.setBigUint64(0, result, true);
      const deadline = bits.getFloat64(0, true) * SECONDS_TO_MILLISECONDS;
      if (!Number.isFinite(deadline)) throw Error("Invalid Foundation lock deadline");
      const wait = () => {
        const result = mutexes.take(self + WORD_BYTES, thread);
        if (result !== undefined) {
          successful(result);
          return 1;
        }
        return Date.now() >= deadline ? 0 : undefined;
      };
      return wait() ?? { wait };
    });
    host.method(name, false, "name", (self) => {
      const value = names.get(self);
      return value === undefined ? 0 : host.string(value);
    });
    host.method(name, false, "setName:", (self, args) => {
      const value = args(Argument.First);
      if (value) names.set(self, host.text(value));
      else names.delete(self);
    });
    host.method(name, false, "dealloc", (self) => {
      const result = mutexes.destroy(self + WORD_BYTES);
      if (result !== MutexError.Invalid) successful(result);
      names.delete(self);
      host.destroy(self);
    });
  }
}
