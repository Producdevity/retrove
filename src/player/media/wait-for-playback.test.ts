import { expect, test, vi } from "vite-plus/test";
import { waitForPlayback } from "./wait-for-playback";
test("closing the app releases an audio resume wait that the browser never settles", async () => {
  const controller = new AbortController(),
    reason = new Error("App closed");
  const wait = waitForPlayback(new Promise<void>(() => {}), controller.signal);
  const rejected = expect(wait).rejects.toBe(reason);
  controller.abort(reason);
  await rejected;
});
test("completion removes the abort listener and preserves playback failure", async () => {
  const controller = new AbortController(),
    remove = vi.spyOn(controller.signal, "removeEventListener");
  const reason = new Error("Audio unavailable");
  await expect(waitForPlayback(Promise.reject(reason), controller.signal)).rejects.toBe(reason);
  expect(remove).toHaveBeenCalledOnce();
  await expect(waitForPlayback(Promise.resolve(), controller.signal)).resolves.toBeUndefined();
  expect(remove).toHaveBeenCalledTimes(2);
});
test("an already stopped app wins over pending playback and handles its later failure", async () => {
  const reason = new Error("Already closed");
  let rejectPlayback = (_error: Error) => {};
  const playback = new Promise<void>((_resolve, reject) => {
    rejectPlayback = reject;
  });
  await expect(waitForPlayback(playback, AbortSignal.abort(reason))).rejects.toBe(reason);
  rejectPlayback(new Error("Context closed during resume"));
  await Promise.resolve();
});
