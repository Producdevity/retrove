import { read32, write32, type GuestMemory } from "./guest-memory";

const WORD_ALIGNMENT = 3;

/**
 * CPUs over a shared memory update guest words with `Atomics`, so host functions stay atomic
 * against translated code on other threads. Interpreters without them run one thread at a time.
 */
export interface AtomicGuestMemory extends GuestMemory {
  compareExchange32?(address: number, expected: number, replacement: number): number;
  add32?(address: number, delta: number): number;
  store32?(address: number, value: number): void;
}
const aligned = (address: number): boolean => (address & WORD_ALIGNMENT) === 0;

/** Stores `replacement` when the word equals `expected`; returns the previous word. */
export function compareExchange32(
  cpu: AtomicGuestMemory,
  address: number,
  expected: number,
  replacement: number,
): number {
  if (cpu.compareExchange32 && aligned(address))
    return cpu.compareExchange32(address, expected, replacement);
  const old = read32(cpu, address);
  if (old === expected >>> 0) write32(cpu, address, replacement);
  return old;
}

/** Adds to the word and returns the new value (OSAtomicAdd32 semantics). */
export function add32(cpu: AtomicGuestMemory, address: number, delta: number): number {
  if (cpu.add32 && aligned(address)) return (cpu.add32(address, delta) + delta) >>> 0;
  const value = (read32(cpu, address) + delta) >>> 0;
  write32(cpu, address, value);
  return value;
}

/** Publishes a word after the writes before it, for values other threads poll without a lock. */
export function store32(cpu: AtomicGuestMemory, address: number, value: number): void {
  if (cpu.store32 && aligned(address)) cpu.store32(address, value);
  else write32(cpu, address, value);
}
