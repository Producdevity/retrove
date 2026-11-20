import { stringImports } from "../../../../web/strings.mjs";
import { pureMathImports, type Argument } from "../../ios/libc/pure-math";
import { fill, move, write32, type GuestMemory } from "../../memory/guest-memory";

/** Returned by a local import that cannot answer on this thread; the main thread runs the call. */
export const Forward = Symbol("forward");
export type LocalImport = (a: Argument) => number | bigint | undefined | typeof Forward;

const STRING_NAMES = [
  "_strlen",
  "_wcslen",
  "_strcmp",
  "_strncmp",
  "_wcscmp",
  "_strchr",
  "_wcschr",
  "_strrchr",
  "_strstr",
  "_wcsstr",
  "_strcpy",
  "_strncpy",
  "_wcscpy",
  "_wcsncpy",
] as const;
const MEMORY_NAMES = ["_memcpy", "_memmove", "_memset", "_bzero"] as const;
const THREAD_NAMES = ["_mach_absolute_time", "_pthread_threadid_np"] as const;
const NS_PER_MS = 1e6;
/** memcpy/memset argument words. */
const Copy = { Target: 0, Source: 1, Value: 1, Size: 2 } as const;
const EINVAL = 22;
const HIGH_WORD = 4;
/** The string functions above never set errno. */
const NO_ERRNO = 0;

/**
 * Imports an execution worker answers itself, without a round trip to the main thread: functions
 * of their arguments and of guest memory alone, plus the thread's own id and the clock. The main
 * thread keeps its own implementations; these match them call for call.
 */
export const LOCAL_IMPORT_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(pureMathImports()),
  ...STRING_NAMES,
  ...MEMORY_NAMES,
  ...THREAD_NAMES,
]);

export interface LocalThread {
  /** Guest thread id (pthread_t). */
  readonly id: number;
  /** The main thread's `performance.timeOrigin`: mach_absolute_time counts from it. */
  readonly timeOrigin: number;
}

export function localImports(memory: GuestMemory, thread: LocalThread): Map<string, LocalImport> {
  const strings = stringImports(memory, NO_ERRNO),
    offset = performance.timeOrigin - thread.timeOrigin;
  const copy: LocalImport = (a) => {
    move(memory, a(Copy.Target), a(Copy.Source), a(Copy.Size));
    return a(Copy.Target);
  };
  const table: Record<string, LocalImport> = {
    ...pureMathImports(),
    _memcpy: copy,
    _memmove: copy,
    _memset: (a) => {
      fill(memory, a(Copy.Target), a(Copy.Value), a(Copy.Size));
      return a(Copy.Target);
    },
    _bzero: (a) => {
      fill(memory, a(0), 0, a(1));
      return undefined;
    },
    _mach_absolute_time: () => BigInt(Math.floor((offset + performance.now()) * NS_PER_MS)),
    // Other threads' ids are the main thread's to check.
    _pthread_threadid_np: (a) => {
      if (a(0) && a(0) !== thread.id) return Forward;
      if (!a(1)) return EINVAL;
      write32(memory, a(1), thread.id);
      write32(memory, a(1) + HIGH_WORD, 0);
      return 0;
    },
  };
  for (const name of STRING_NAMES) {
    const run = strings[name];
    if (run) table[name] = run;
  }
  return new Map(Object.entries(table).filter(([name]) => LOCAL_IMPORT_NAMES.has(name)));
}
