import { afterEach, expect, test, vi } from "vite-plus/test";
import { nextDisplayRefresh, DISPLAY_INTERVAL_MS } from "./display-refresh";
class Visibility extends EventTarget {
  hidden = false;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
test("hiding a page wakes a pending animation frame and cancels its callback", async () => {
  const source = new Visibility(),
    cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.spyOn(performance, "now").mockReturnValue(123);
  const refresh = nextDisplayRefresh(undefined, source);
  source.hidden = true;
  source.dispatchEvent(new Event("visibilitychange"));
  await expect(refresh).resolves.toBe(123);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(0);
  source.dispatchEvent(new Event("visibilitychange"));
  expect(cancel).toHaveBeenCalledTimes(1);
});
test("hidden pages sleep until visible and abort releases the pending wait", async () => {
  vi.useFakeTimers();
  const source = new Visibility();
  source.hidden = true;
  const controller = new AbortController(),
    reason = new Error("stopped");
  const refresh = nextDisplayRefresh(controller.signal, source);
  const rejected = expect(refresh).rejects.toBe(reason);
  controller.abort(reason);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  const next = nextDisplayRefresh(undefined, source);
  expect(vi.getTimerCount()).toBe(0);
  source.hidden = false;
  source.dispatchEvent(new Event("visibilitychange"));
  await expect(next).resolves.toBeTypeOf("number");
  expect(vi.getTimerCount()).toBe(0);
});

test("visible pages without animation frames use the display timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", undefined);
  const next = nextDisplayRefresh(undefined, new Visibility());
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(DISPLAY_INTERVAL_MS);
  await expect(next).resolves.toBeTypeOf("number");
  expect(vi.getTimerCount()).toBe(0);
});
