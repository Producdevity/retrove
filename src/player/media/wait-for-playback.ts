export function waitForPlayback(playback: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return playback;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", aborted);
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    playback.then(
      () => {
        cleanup();
        resolve();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}
