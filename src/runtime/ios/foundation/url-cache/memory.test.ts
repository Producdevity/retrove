import { expect, test } from "vite-plus/test";
import { MemoryURLCache } from "./memory";
test("URL cache evicts the least recently used data and releases replaced or oversized values", () => {
  const cache = new MemoryURLCache<number>(6);
  expect(cache.store("a", 1, 3)).toEqual([]);
  expect(cache.store("b", 2, 3)).toEqual([]);
  expect(cache.get("a")).toBe(1);
  expect(cache.store("c", 3, 3)).toEqual([2]);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.store("a", 4, 3)).toEqual([1]);
  expect(cache.usage).toBe(6);
  expect(cache.store("large", 5, 7)).toEqual([5]);
  expect(cache.usage).toBe(6);
  expect(cache.resize(0)).toEqual([3, 4]);
  expect(cache.usage).toBe(0);
  expect(cache.store("empty", 6, 0)).toEqual([6]);
  expect(() => cache.resize(-1)).toThrow(/capacity/);
});
test("zero-byte entries are bounded independently of their content size", () => {
  const cache = new MemoryURLCache<number>(1);
  let removed = 0;
  for (let i = 0; i < 1025; i++) removed += cache.store(String(i), i, 0).length;
  expect(removed).toBe(1);
  expect(cache.get("0")).toBeUndefined();
  expect(cache.clear().length).toBe(1024);
  expect(cache.usage).toBe(0);
});
