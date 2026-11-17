const REFRESH_HERTZ = 60;
const MILLISECONDS_PER_SECOND = 1000;
export const DISPLAY_INTERVAL_MS = MILLISECONDS_PER_SECOND / REFRESH_HERTZ;
export interface VisibilitySource extends EventTarget {
  readonly hidden: boolean;
}
export function nextDisplayRefresh(
  signal?: AbortSignal,
  visibility?: VisibilitySource,
): Promise<number> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      visibility?.removeEventListener("visibilitychange", changed);
    };
    const finish = (time: number) => {
      cleanup();
      resolve(time);
    };
    const changed = () => finish(performance.now());
    const abort = () => {
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    visibility?.addEventListener("visibilitychange", changed);
    if (typeof requestAnimationFrame === "function" && !visibility?.hidden)
      frame = requestAnimationFrame(finish);
    else if (!visibility?.hidden)
      timer = setTimeout(() => finish(performance.now()), DISPLAY_INTERVAL_MS);
  });
}
const MINIMUM_WORKER_SLICE_MS = 8;
const MAIN_THREAD_RESERVE_MS = 2;
export function workerSliceMs(refreshTime: number, now: number): number {
  return Math.max(
    MINIMUM_WORKER_SLICE_MS,
    refreshTime + DISPLAY_INTERVAL_MS - MAIN_THREAD_RESERVE_MS - now,
  );
}
