import { compareExchange32, store32 } from "../../memory/guest-atomics";
import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../objc/host";
import { GuestMutexes, MutexType } from "./mutex";
import type { ThreadTable } from "./thread-table";
import { asWait, KernReturn, ThreadError, type ThreadCpu } from "./thread-types";

const WORD_BYTES = 4;
const MS_PER_SECOND = 1000;
const NS_PER_MS = 1e6;
const US_PER_MS = 1000;
const NS_PER_SECOND = 1e9;
const Arg = { Third: 2, Fourth: 3 } as const;
interface Waiter {
  signaled: boolean;
}
interface Semaphore {
  value: number;
  alive: boolean;
}

export function guestMutexes(cpu: ThreadCpu): GuestMutexes {
  return new GuestMutexes({
    read: (p) => read32(cpu, p),
    write: (p, value) => write32(cpu, p, value),
    compareExchange: (p, expected, value) => compareExchange32(cpu, p, expected, value),
    store: (p, value) => store32(cpu, p, value),
  });
}

/** pthread mutexes and their attributes. */
export function mutexImports(table: ThreadTable, mutexes: GuestMutexes) {
  const mutexAttrs = new Map<number, number>();
  return {
    _pthread_mutexattr_init: (a: GuestArguments) => {
      mutexAttrs.set(a(0), 0);
      return 0;
    },
    _pthread_mutexattr_settype: (a: GuestArguments) => {
      if (!mutexAttrs.has(a(0)) || a(1) > MutexType.Recursive) return ThreadError.Invalid;
      mutexAttrs.set(a(0), a(1));
      return 0;
    },
    _pthread_mutexattr_destroy: (a: GuestArguments) =>
      mutexAttrs.delete(a(0)) ? 0 : ThreadError.Invalid,
    _pthread_mutex_init: (a: GuestArguments) => {
      const type = a(1) ? mutexAttrs.get(a(1)) : 0;
      if (type === undefined) return ThreadError.Invalid;
      return mutexes.initialize(a(0), type);
    },
    _pthread_mutex_destroy: (a: GuestArguments) => mutexes.destroy(a(0)),
    _pthread_mutex_lock: (a: GuestArguments) => mutexes.lock(a(0), table.current.id, false),
    _pthread_mutex_trylock: (a: GuestArguments) => mutexes.lock(a(0), table.current.id, true),
    _pthread_mutex_unlock: (a: GuestArguments) => mutexes.unlock(a(0), table.current.id),
  };
}

/** pthread condition variables over the guest mutexes. */
export function conditionImports(cpu: ThreadCpu, table: ThreadTable, mutexes: GuestMutexes) {
  const conditions = new Map<number, Waiter[]>();
  const cond = (p: number): Waiter[] => {
    let waiters = conditions.get(p);
    if (!waiters) conditions.set(p, (waiters = []));
    return waiters;
  };
  const waitCond = (a: GuestArguments, timed: boolean) => {
    const q = cond(a(0)),
      pointer = a(1),
      id = table.current.id;
    if (!mutexes.ownsOnce(pointer, id)) return ThreadError.Invalid;
    let deadline = Infinity;
    if (timed) {
      const t = a(Arg.Third),
        ns = read32(cpu, t + WORD_BYTES);
      if (ns >= NS_PER_SECOND) return ThreadError.Invalid;
      deadline = (read32(cpu, t) | 0) * MS_PER_SECOND + ns / NS_PER_MS;
    }
    const waiter: Waiter = { signaled: false };
    q.push(waiter);
    mutexes.unlock(pointer, id);
    return asWait(() => {
      if (!waiter.signaled && Date.now() < deadline) return undefined;
      if (mutexes.take(pointer, id) === undefined) return undefined;
      q.splice(q.indexOf(waiter), 1);
      return waiter.signaled ? 0 : ThreadError.TimedOut;
    });
  };
  return {
    _pthread_cond_init: (a: GuestArguments) => {
      conditions.set(a(0), []);
      return 0;
    },
    _pthread_cond_destroy: (a: GuestArguments) => {
      if (cond(a(0)).length) return ThreadError.Busy;
      conditions.delete(a(0));
      return 0;
    },
    _pthread_cond_wait: (a: GuestArguments) => waitCond(a, false),
    _pthread_cond_timedwait: (a: GuestArguments) => waitCond(a, true),
    _pthread_cond_signal: (a: GuestArguments) => {
      const w = cond(a(0)).find((x) => !x.signaled);
      if (w) w.signaled = true;
      return 0;
    },
    _pthread_cond_broadcast: (a: GuestArguments) => {
      for (const w of cond(a(0))) w.signaled = true;
      return 0;
    },
  };
}

/** Mach semaphores. */
export function semaphoreImports(cpu: ThreadCpu) {
  const semaphores = new Map<number, Semaphore>();
  let nextSemaphore = 1;
  return {
    _semaphore_create: (a: GuestArguments) => {
      const value = a(Arg.Fourth) | 0;
      if (value < 0) return KernReturn.InvalidArgument;
      const key = nextSemaphore++;
      semaphores.set(key, { value, alive: true });
      write32(cpu, a(1), key);
      return 0;
    },
    _semaphore_destroy: (a: GuestArguments) => {
      const s = semaphores.get(a(1));
      if (!s) return KernReturn.InvalidArgument;
      s.alive = false;
      semaphores.delete(a(1));
      return 0;
    },
    _semaphore_signal: (a: GuestArguments) => {
      const s = semaphores.get(a(0));
      if (!s) return KernReturn.InvalidArgument;
      s.value++;
      return 0;
    },
    _semaphore_wait: (a: GuestArguments) => {
      const s = semaphores.get(a(0));
      if (!s) return KernReturn.InvalidArgument;
      return asWait(() => {
        if (!s.alive) return KernReturn.Terminated;
        if (s.value) {
          s.value--;
          return 0;
        }
        return undefined;
      });
    },
  };
}

const sleepUntil = (at: number) => asWait(() => (performance.now() >= at ? 0 : undefined));
/** usleep, nanosleep and sleep block only the calling guest thread. */
export function sleepImports(cpu: ThreadCpu) {
  return {
    _usleep: (a: GuestArguments) => sleepUntil(performance.now() + a(0) / US_PER_MS),
    _nanosleep: (a: GuestArguments) => {
      const at =
        performance.now() +
        read32(cpu, a(0)) * MS_PER_SECOND +
        read32(cpu, a(0) + WORD_BYTES) / NS_PER_MS;
      if (a(1)) {
        write32(cpu, a(1), 0);
        write32(cpu, a(1) + WORD_BYTES, 0);
      }
      return sleepUntil(at);
    },
    _sleep: (a: GuestArguments) => sleepUntil(performance.now() + a(0) * MS_PER_SECOND),
  };
}
