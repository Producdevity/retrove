import { expect, test, vi } from "vite-plus/test";
import { onUserActivation } from "./activation";

test("a gesture runs pending unlocks once and reports failures", async () => {
  const target = new EventTarget(),
    report = vi.fn();
  let pending = true;
  const unlock = vi.fn(() => {
    if (!pending) return [];
    pending = false;
    return [Promise.resolve(), Promise.reject(new Error("denied"))];
  });
  onUserActivation(target, unlock, report);
  target.dispatchEvent(new Event("pointerup"));
  target.dispatchEvent(new Event("touchend"));
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  expect(report.mock.calls[0]?.[0]).toEqual(new Error("denied"));
  target.dispatchEvent(new Event("keydown"));
  expect(unlock).toHaveBeenCalledTimes(2);
});
