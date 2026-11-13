import { expect, test } from "vite-plus/test";
import { UnicornContexts } from "./contexts";
test("contexts remain independent across reuse and stale handles cannot restore newer states", () => {
  let value = 0,
    next = 0;
  const saved = new Map<number, number>(),
    freed: number[] = [];
  const contexts = new UnicornContexts({
    allocate: () => ++next,
    save: (handle: number) => saved.set(handle, value),
    restore: (handle) => {
      value = saved.get(handle) ?? -1;
    },
    free: (handle) => {
      freed.push(handle);
      saved.delete(handle);
    },
  });
  value = 10;
  const first = contexts.save();
  value = 20;
  const second = contexts.save();
  contexts.restore(first);
  expect(value).toBe(10);
  contexts.release(first);
  value = 30;
  const replacement = contexts.save();
  expect(next).toBe(2);
  expect(() => contexts.restore(first)).toThrow(/Unknown/);
  contexts.release(first);
  contexts.restore(second);
  expect(value).toBe(20);
  contexts.restore(replacement);
  expect(value).toBe(30);
  contexts.release(second);
  contexts.close();
  contexts.close();
  expect(freed.sort((left, right) => left - right)).toEqual([1, 2]);
  expect(() => contexts.save()).toThrow(/closed/);
});
test("pool capacity is bounded and a failed save releases its native allocation", () => {
  let next = 0,
    fail = false;
  const freed: number[] = [];
  const contexts = new UnicornContexts({
    allocate: () => ++next,
    save: () => {
      if (fail) throw new Error("save failed");
    },
    restore: () => {},
    free: (handle: number) => {
      freed.push(handle);
    },
  });
  const live = Array.from({ length: 32 }, () => contexts.save());
  for (const context of live) contexts.release(context);
  expect(freed).toHaveLength(16);
  fail = true;
  expect(() => contexts.save()).toThrow("save failed");
  contexts.close();
  expect(new Set(freed).size).toBe(32);
  expect(freed).toHaveLength(32);
});
