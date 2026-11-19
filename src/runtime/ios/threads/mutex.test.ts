import { expect, test } from "vite-plus/test";
import { GuestMutexes, MutexError, MutexLayout, MutexType, StaticMutex } from "./mutex";
function fixture() {
  const words = new Map<number, number>();
  const read = (pointer: number) => words.get(pointer) ?? 0,
    write = (pointer: number, value: number) => {
      words.set(pointer, value);
    };
  const memory = {
    read,
    write,
    store: write,
    compareExchange: (pointer: number, expected: number, replacement: number) => {
      const old = read(pointer);
      if (old === expected) write(pointer, replacement);
      return old;
    },
  };
  return { mutexes: new GuestMutexes(memory), memory };
}
test("static mutexes initialize lazily and ownership controls destruction", () => {
  const { mutexes, memory } = fixture();
  for (const signature of Object.values(StaticMutex)) {
    const pointer = signature;
    memory.write(pointer, signature);
    expect(mutexes.lock(pointer, 1, false)).toBe(0);
    expect(mutexes.ownsOnce(pointer, 1)).toBe(true);
    expect(mutexes.destroy(pointer)).toBe(MutexError.Busy);
    expect(mutexes.unlock(pointer, 2)).toBe(MutexError.Permission);
    expect(mutexes.unlock(pointer, 1)).toBe(0);
    expect(mutexes.destroy(pointer)).toBe(0);
    expect(mutexes.lock(pointer, 1, false)).toBe(MutexError.Invalid);
    expect(mutexes.initialize(pointer, MutexType.Normal)).toBe(0);
    expect(mutexes.destroy(pointer)).toBe(0);
  }
});
test("contended locks wait until the owner releases and trylock never waits", () => {
  const { mutexes } = fixture();
  const pointer = 0x1000;
  mutexes.initialize(pointer, MutexType.Normal);
  expect(mutexes.lock(pointer, 1, false)).toBe(0);
  expect(mutexes.lock(pointer, 2, true)).toBe(MutexError.Busy);
  const pending = mutexes.lock(pointer, 2, false);
  if (typeof pending === "number") throw new Error("Expected a blocked worker.");
  expect(pending.wait()).toBeUndefined();
  expect(mutexes.unlock(pointer, 1)).toBe(0);
  expect(pending.wait()).toBe(0);
  expect(mutexes.ownsOnce(pointer, 2)).toBe(true);
  expect(mutexes.unlock(pointer, 1)).toBe(MutexError.Permission);
  expect(mutexes.unlock(pointer, 2)).toBe(0);
});
test("recursive locks retain their owner until the final release and reject overflow", () => {
  const { mutexes, memory } = fixture();
  const pointer = 0x1000;
  mutexes.initialize(pointer, MutexType.Recursive);
  expect(mutexes.lock(pointer, 1, false)).toBe(0);
  expect(mutexes.lock(pointer, 1, true)).toBe(0);
  expect(mutexes.ownsOnce(pointer, 1)).toBe(false);
  expect(mutexes.lock(pointer, 2, true)).toBe(MutexError.Busy);
  expect(mutexes.unlock(pointer, 1)).toBe(0);
  expect(mutexes.ownsOnce(pointer, 1)).toBe(true);
  memory.write(pointer + MutexLayout.Depth, MutexLayout.MaximumDepth);
  expect(mutexes.lock(pointer, 1, false)).toBe(MutexError.Again);
  expect(memory.read(pointer + MutexLayout.Depth)).toBe(MutexLayout.MaximumDepth);
});
test("error-checking and normal mutexes preserve their distinct relock behavior", () => {
  const { mutexes } = fixture();
  const pointer = 0x1000;
  expect(mutexes.initialize(pointer, 99)).toBe(MutexError.Invalid);
  expect(mutexes.lock(pointer, 1, false)).toBe(MutexError.Invalid);
  mutexes.initialize(pointer, MutexType.ErrorChecking);
  expect(mutexes.lock(pointer, 1, false)).toBe(0);
  expect(mutexes.lock(pointer, 1, false)).toBe(MutexError.Deadlock);
  expect(mutexes.lock(pointer, 1, true)).toBe(MutexError.Busy);
  mutexes.unlock(pointer, 1);
  mutexes.initialize(pointer, MutexType.Normal);
  expect(mutexes.lock(pointer, 1, false)).toBe(0);
  const pending = mutexes.lock(pointer, 1, false);
  if (typeof pending === "number") throw new Error("Normal relocking should block.");
  expect(pending.wait()).toBeUndefined();
});
