import { add32, compareExchange32, type AtomicGuestMemory } from "../../memory/guest-atomics";
import type { LocalImport } from "./local-import-types";

export const ATOMIC_NAMES = [
  "_OSAtomicAdd32Barrier",
  "_OSAtomicCompareAndSwap32Barrier",
  "_OSAtomicCompareAndSwapPtrBarrier",
] as const;
/** OSAtomicCompareAndSwap argument words: old value, new value, address. */
const Swap = { Expected: 0, Replacement: 1, Address: 2 } as const;
/** OSAtomicAdd32 argument words: delta, address. */
const Add = { Delta: 0, Address: 1 } as const;

/** Word atomics over the shared guest memory, the same operations the main thread runs. */
export function atomicImports(
  memory: AtomicGuestMemory,
): Record<(typeof ATOMIC_NAMES)[number], LocalImport> {
  const swap: LocalImport = (a) =>
    Number(
      compareExchange32(memory, a(Swap.Address), a(Swap.Expected), a(Swap.Replacement)) ===
        a(Swap.Expected) >>> 0,
    );
  return {
    _OSAtomicAdd32Barrier: (a) => add32(memory, a(Add.Address), a(Add.Delta)),
    _OSAtomicCompareAndSwap32Barrier: swap,
    _OSAtomicCompareAndSwapPtrBarrier: swap,
  };
}
