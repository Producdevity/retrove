import { expect, test, vi } from "vite-plus/test";
import { ThreadDeliveries } from "./thread-delivery";
import { RunLoopMode } from "./ports";
const THREAD = 7;
const TARGET = 100;
const ARGUMENT = 101;
function fixture() {
  const send = vi.fn(async (_self: number, _selector: string, _args: number[]) => 0);
  const retain = vi.fn((pointer: number) => pointer);
  const release = vi.fn(async (_pointer: number) => {});
  return {
    send,
    retain,
    release,
    queue: new ThreadDeliveries({ send, retain, release, currentThread: () => THREAD }),
  };
}
test("thread deliveries wait for their owning run loop and release arguments after dispatch", async () => {
  const x = fixture(),
    wait = x.queue.deliver(THREAD, TARGET, "work:", ARGUMENT, false);
  expect(wait).toBeUndefined();
  expect(await x.queue.pump(THREAD + 1, RunLoopMode.Default)).toBe(false);
  expect(await x.queue.pump(THREAD, "custom")).toBe(false);
  expect(x.send).not.toHaveBeenCalled();
  expect(x.queue.pending(THREAD, RunLoopMode.Default)).toBe(true);
  expect(await x.queue.pump(THREAD, RunLoopMode.Default)).toBe(true);
  expect(x.send).toHaveBeenCalledWith(TARGET, "work:", [ARGUMENT]);
  expect(x.release.mock.calls).toEqual([[TARGET], [ARGUMENT]]);
  expect(x.queue.pending(THREAD, RunLoopMode.Default)).toBe(false);
});
test("same-thread synchronous delivery executes directly without enqueuing", async () => {
  const x = fixture();
  await x.queue.deliver(THREAD, TARGET, "work:", ARGUMENT, true);
  expect(x.send).toHaveBeenCalledOnce();
  expect(x.retain).not.toHaveBeenCalled();
  expect(x.queue.pending(THREAD, RunLoopMode.Default)).toBe(false);
});
