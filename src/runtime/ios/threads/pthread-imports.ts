import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../objc/host";
import { DEFAULT_PRIORITY, type ThreadAttributes, ThreadPolicy } from "./attributes";
import { TLS_KEYS, type ThreadTable } from "./thread-table";
import {
  asWait,
  MAIN_THREAD,
  ThreadError,
  type SpawnedThread,
  type ThreadCpu,
} from "./thread-types";

const WORD_BYTES = 4;
const Arg = { Third: 2, Fourth: 3 } as const;
interface Schedule {
  readonly policy: number;
  readonly priority: number;
}
const isPolicy = (value: number): boolean =>
  Object.values(ThreadPolicy).some((policy) => policy === value);

/** pthread attributes and scheduling parameters. */
export function attributeImports(cpu: ThreadCpu, table: ThreadTable, attrs: ThreadAttributes) {
  // Priorities are recorded for the guest to read back; the cooperative scheduler does not use them.
  const schedules = new Map<number, Schedule>();
  return {
    _pthread_attr_init: (a: GuestArguments) => attrs.initialize(a(0)),
    _pthread_attr_destroy: (a: GuestArguments) => attrs.destroy(a(0)),
    _pthread_attr_setstacksize: (a: GuestArguments) => attrs.stackSize(a(0), a(1)),
    _pthread_attr_setdetachstate: (a: GuestArguments) => attrs.detach(a(0), a(1)),
    _pthread_attr_setschedpolicy: (a: GuestArguments) => attrs.policy(a(0), a(1)),
    _pthread_attr_setschedparam: (a: GuestArguments) =>
      a(1) ? attrs.priority(a(0), read32(cpu, a(1)) | 0) : ThreadError.Invalid,
    _pthread_getschedparam: (a: GuestArguments) => {
      if (!table.exists(a(0))) return ThreadError.NoSuchThread;
      const value = schedules.get(a(0)) ?? {
        policy: ThreadPolicy.Other,
        priority: DEFAULT_PRIORITY,
      };
      if (a(1)) write32(cpu, a(1), value.policy);
      if (a(Arg.Third)) write32(cpu, a(Arg.Third), value.priority);
      return 0;
    },
    _pthread_setschedparam: (a: GuestArguments) => {
      if (!table.exists(a(0))) return ThreadError.NoSuchThread;
      if (!a(Arg.Third) || !isPolicy(a(1))) return ThreadError.Invalid;
      schedules.set(a(0), { policy: a(1), priority: read32(cpu, a(Arg.Third)) | 0 });
      return 0;
    },
  };
}

/** Thread creation, identity, exit, detach and join. */
export function lifecycleImports(cpu: ThreadCpu, table: ThreadTable, attrs: ThreadAttributes) {
  const create = (a: GuestArguments): number => {
    const [out, attr, pc, arg] = [a(0), a(1), a(Arg.Third), a(Arg.Fourth)];
    if (!out || !pc || (attr && !attrs.has(attr))) return ThreadError.Invalid;
    const id = table.spawn(pc, [arg], attrs.get(attr) || {});
    if (!id) return ThreadError.Again;
    write32(cpu, out, id);
    return 0;
  };
  const join = (thread: SpawnedThread | undefined, id: number, pointer: number) => {
    if (id === table.current.id) return ThreadError.Deadlock;
    if (!thread) return ThreadError.NoSuchThread;
    if (thread.detached || thread.joining) return ThreadError.Invalid;
    thread.joining = true;
    return asWait(() => {
      if (!thread.done) return undefined;
      if (pointer) write32(cpu, pointer, thread.value ?? 0);
      table.reap(thread);
      return 0;
    });
  };
  return {
    _pthread_create: create,
    _pthread_self: () => table.current.id,
    _pthread_main_np: () => Number(table.current.id === MAIN_THREAD),
    _pthread_equal: (a: GuestArguments) => Number(a(0) === a(1)),
    _pthread_mach_thread_np: (a: GuestArguments) => (table.exists(a(0)) ? a(0) : 0),
    _pthread_threadid_np: (a: GuestArguments) => {
      const id = a(0) || table.current.id;
      if (!a(1)) return ThreadError.Invalid;
      if (!table.exists(id)) return ThreadError.NoSuchThread;
      write32(cpu, a(1), id);
      write32(cpu, a(1) + WORD_BYTES, 0);
      return 0;
    },
    _pthread_setname_np: () => 0,
    _pthread_exit: (a: GuestArguments) => ({ threadExit: a(0) }),
    _pthread_detach: (a: GuestArguments) => {
      const thread = table.workers.get(a(0));
      if (!thread) return ThreadError.NoSuchThread;
      if (thread.detached || thread.joining) return ThreadError.Invalid;
      thread.detached = true;
      if (thread.done) table.reap(thread);
      return 0;
    },
    _pthread_join: (a: GuestArguments) => join(table.workers.get(a(0)), a(0), a(1)),
  };
}

/** Thread-specific data; values are mirrored in each thread's guest key table. */
export function keyImports(cpu: ThreadCpu, table: ThreadTable) {
  let nextKey = 1;
  return {
    _pthread_key_create: (a: GuestArguments) => {
      if (nextKey >= TLS_KEYS) return ThreadError.Again;
      const key = nextKey++;
      table.keys.set(key, a(1));
      write32(cpu, a(0), key);
      return 0;
    },
    _pthread_key_delete: (a: GuestArguments) => {
      if (!table.keys.delete(a(0))) return ThreadError.Invalid;
      for (const thread of [table.main, ...table.workers.values()]) {
        thread.tls.delete(a(0));
        if (thread.pointer) table.setKeySlot(thread, a(0), 0);
      }
      return 0;
    },
    _pthread_setspecific: (a: GuestArguments) => {
      if (!table.keys.has(a(0))) return ThreadError.Invalid;
      table.current.tls.set(a(0), a(1));
      table.setKeySlot(table.current, a(0), a(1));
      return 0;
    },
    _pthread_getspecific: (a: GuestArguments) => table.current.tls.get(a(0)) || 0,
  };
}
