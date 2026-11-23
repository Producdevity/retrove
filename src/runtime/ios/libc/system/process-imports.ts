import { write32, type GuestMemory } from "../../../memory/guest-memory";
import { add32, compareExchange32 } from "../../../memory/guest-atomics";
import { Argument } from "../../objc/host";
import { Errno } from "../files/errno";
import type { CallGuest, Finalizer, SystemCpu, SystemImport } from "./types";

const MAX_SIGNAL = 31;
const Signal = {
  Kill: 9,
  Stop: 17,
  Urgent: 16,
  Continue: 19,
  Child: 20,
  WindowChange: 28,
  Info: 29,
} as const;
const DEFAULT_IGNORED_SIGNALS: readonly number[] = [
  Signal.Urgent,
  Signal.Continue,
  Signal.Child,
  Signal.WindowChange,
  Signal.Info,
];
const SIGNAL_ERROR = 0xffffffff;
const SIGNAL_IGNORE = 1;

export function signalImports(
  cpu: GuestMemory,
  errno: number,
  callGuest: CallGuest,
): Record<string, SystemImport> {
  const signals = new Map<number, number>();
  return {
    _getpid: () => 1,
    _signal: (a) => {
      const number = a(0),
        handler = a(1);
      if (
        !number ||
        number > MAX_SIGNAL ||
        number === Signal.Kill ||
        number === Signal.Stop ||
        handler === SIGNAL_ERROR
      ) {
        write32(cpu, errno, Errno.Invalid);
        return SIGNAL_ERROR;
      }
      const previous = signals.get(number) ?? 0;
      signals.set(number, handler);
      return previous;
    },
    _raise: async (a) => {
      const number = a(0),
        handler = signals.get(number) ?? 0;
      if (!number || number > MAX_SIGNAL) {
        write32(cpu, errno, Errno.Invalid);
        return -1;
      }
      if (handler === SIGNAL_IGNORE || (!handler && DEFAULT_IGNORED_SIGNALS.includes(number)))
        return 0;
      if (handler) {
        await callGuest(handler, [number]);
        return 0;
      }
      throw Error(`Guest received Darwin signal ${number}`);
    },
  };
}

export function lifecycleImports(
  threadID: () => number,
  finalizers: Finalizer[],
  cpu: GuestMemory,
): Record<string, SystemImport> {
  const guardsInProgress = new Map<number, number>();
  return {
    ___cxa_atexit: (a) => {
      finalizers.push({ pc: a(0), arg: a(1), image: a(Argument.Third) });
      return 0;
    },
    ___cxa_guard_acquire: (a) => {
      const address = a(0),
        owner = threadID();
      if (guardsInProgress.get(address) === owner)
        throw new Error("Reentrant local static initialization");
      const poll = (): number | undefined => {
        if ((cpu.read(address, 1)[0] ?? 0) & 1) return 0;
        if (guardsInProgress.has(address)) return undefined;
        guardsInProgress.set(address, owner);
        return 1;
      };
      return poll() ?? { wait: poll };
    },
    ___cxa_guard_release: (a) => {
      cpu.write(a(0), Uint8Array.of(1));
      guardsInProgress.delete(a(0));
    },
    ___cxa_guard_abort: (a) => {
      guardsInProgress.delete(a(0));
    },
    ___stack_chk_fail: () => {
      throw new Error("Guest stack check failed");
    },
    _abort: () => {
      throw new Error("Guest called abort()");
    },
    _exit: (a) => ({ exit: a(0) | 0 }),
  };
}

export function atomicImports(cpu: SystemCpu): Record<string, SystemImport> {
  const compareSwap: SystemImport = (a) =>
    Number(compareExchange32(cpu, a(Argument.Third), a(0), a(1)) === a(0) >>> 0);
  return {
    _OSAtomicAdd32Barrier: (a) => add32(cpu, a(1), a(0)),
    _OSAtomicCompareAndSwap32Barrier: compareSwap,
    _OSAtomicCompareAndSwapPtrBarrier: compareSwap,
  };
}
