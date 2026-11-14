import { expect, test, vi } from "vite-plus/test";
import { installThreadInstances } from "./thread-instances";
import type { HostMethod, HostResult } from "../objc/host";
const SELF = 100,
  TARGET = 101,
  ARGUMENT = 102,
  SELECTOR = 103;
function fixture() {
  const methods = new Map<string, HostMethod>();
  const workers: { task(): Promise<void>; exited(): Promise<void> }[] = [];
  const retain = vi.fn((value: number) => value),
    release = vi.fn(async (_value: number) => {}),
    delivered = vi.fn();
  const invoke = async (selector: string, args: number[] = []): Promise<HostResult> => {
    const method = methods.get(selector);
    if (!method) throw new Error("Missing test method");
    return method(SELF, (index) => args[index] ?? 0);
  };
  const threads = installThreadInstances({
    hostClass: () => 0,
    method: (_name, _meta, selector, method) => methods.set(selector, method),
    alloc: () => 0,
    destroy: () => {},
    retain,
    release,
    autorelease: (value) => value,
    text: String,
    string: Number,
    write: () => {},
    selector: () => "work:",
    send: async (self, selector, args) => {
      if (self === SELF) return invoke(selector, args);
      delivered(self, selector, args);
      return 0;
    },
    spawn: (_self, task, exited) => {
      workers.push({ task, exited });
    },
  });
  return { invoke, workers, delivered, retain, release, threads };
}
test("NSThread retains its invocation and runs on a scheduled worker with stable lifecycle state", async () => {
  const x = fixture();
  await x.invoke("initWithTarget:selector:object:", [TARGET, SELECTOR, ARGUMENT]);
  await x.invoke("start");
  expect(await x.invoke("isExecuting")).toBe(1);
  expect(x.delivered).not.toHaveBeenCalled();
  const worker = x.workers[0];
  if (!worker) throw new Error("No worker");
  await worker.task();
  await worker.exited();
  expect(x.delivered).toHaveBeenCalledWith(TARGET, "work:", [ARGUMENT]);
  expect(await x.invoke("isFinished")).toBe(1);
  expect(await x.invoke("isExecuting")).toBe(0);
  await expect(x.invoke("start")).rejects.toThrow("once");
  await x.invoke("dealloc");
  expect(x.release.mock.calls).toEqual([[SELF], [TARGET], [ARGUMENT]]);
});
test("cancellation before a new thread starts avoids invoking the target", async () => {
  const x = fixture();
  await x.invoke("initWithTarget:selector:object:", [TARGET, SELECTOR, ARGUMENT]);
  await x.invoke("cancel");
  await x.invoke("start");
  const worker = x.workers[0];
  if (!worker) throw new Error("No worker");
  await worker.task();
  await worker.exited();
  expect(await x.invoke("isCancelled")).toBe(1);
  expect(await x.invoke("isFinished")).toBe(1);
  expect(x.delivered).not.toHaveBeenCalled();
});
