// Browsers grant audio, video and motion access only inside a user gesture, so the first
// tap or key press on the player performs whichever unlocks are still pending.
const ACTIVATION_EVENTS = ["pointerup", "touchend", "keydown"] as const;
/** A play() that never settles must not swallow every later tap. */
export const ACTIVATION_TIMEOUT_MS = 3000;

export function onUserActivation(
  target: EventTarget,
  unlock: () => Promise<unknown>[],
  report: (error: unknown) => void,
): void {
  let running = false;
  const listener = () => {
    if (running) return;
    const tasks = unlock();
    if (!tasks.length) return;
    running = true;
    const timeout = setTimeout(() => {
      running = false;
    }, ACTIVATION_TIMEOUT_MS);
    void Promise.allSettled(tasks).then((results) => {
      clearTimeout(timeout);
      running = false;
      for (const result of results) if (result.status === "rejected") report(result.reason);
    });
  };
  for (const name of ACTIVATION_EVENTS)
    target.addEventListener(name, listener, { capture: true, passive: true });
}
