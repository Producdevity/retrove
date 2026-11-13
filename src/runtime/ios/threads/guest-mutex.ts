import { ExecutionBudget } from "../../cpu/execution-budget";
import artifact from "./guest-mutex.json";
const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
interface GuestMemory {
  write(address: number, bytes: Uint8Array): void;
  protect(address: number, size: number, permissions: number): void;
}
interface GuestHeap {
  alloc(size: number, alignment: number): number;
}
export function guestMutexFunctions(
  cpu: GuestMemory,
  heap: GuestHeap,
  options: { readonly budget: ExecutionBudget; readonly lock: number; readonly unlock: number },
): ReadonlyMap<string, number> {
  // Ownership tests and writes share one ARM block; instruction-level preemption is unsafe here.
  if (options.budget !== ExecutionBudget.Blocks) return new Map();
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  const view = new DataView(code.buffer);
  view.setUint32(artifact.symbols.retrove_mutex_lock_fallback, options.lock, true);
  view.setUint32(artifact.symbols.retrove_mutex_unlock_fallback, options.unlock, true);
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!base) throw new Error("Unable to allocate ARM mutex helpers.");
  cpu.write(base, code);
  cpu.protect(base, PAGE_BYTES, READ_EXECUTE);
  return new Map([
    ["_pthread_mutex_lock", base + artifact.symbols.retrove_mutex_lock],
    ["_pthread_mutex_unlock", base + artifact.symbols.retrove_mutex_unlock],
  ]);
}
