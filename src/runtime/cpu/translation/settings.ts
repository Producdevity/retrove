const TRANSLATION_KEY = "retrove.translation";
/** Translation is on unless a tester turns it off for this browser (`retrove.translation=off`). */
export function translationEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(TRANSLATION_KEY) !== "off";
  } catch {
    return true;
  }
}
const WORKER_KEY = "retrove.translationWorker";
/** Translation runs on a worker unless a tester keeps it on the main thread (`retrove.translationWorker=off`). */
export function translationWorkerEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(WORKER_KEY) !== "off";
  } catch {
    return true;
  }
}
const CACHE_KEY = "retrove.translationCache";
/** Translated modules and profiles are kept between launches unless a tester turns that off (`retrove.translationCache=off`). */
export function translationCacheEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(CACHE_KEY) !== "off";
  } catch {
    return true;
  }
}
const AHEAD_KEY = "retrove.translationAhead";
/** Ahead-of-time chunks are used unless a tester turns them off (`retrove.translationAhead=off`). */
export function translationAheadEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(AHEAD_KEY) !== "off";
  } catch {
    return true;
  }
}
const CPU_KEY = "retrove.cpu";
/** Guests run on translated code alone unless a tester picks Unicorn (`retrove.cpu=unicorn`). */
export function ownCpuEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(CPU_KEY) !== "unicorn";
  } catch {
    return true;
  }
}
/** Records the tester's choice; the next launch uses it. */
export function setOwnCpuEnabled(enabled: boolean): void {
  if (enabled) globalThis.localStorage?.removeItem(CPU_KEY);
  else globalThis.localStorage?.setItem(CPU_KEY, "unicorn");
}
const SHARED_MEMORY_KEY = "retrove.sharedMemory";
/**
 * Guest memory is shared only when a tester opts in (`retrove.sharedMemory=on`): until guest threads
 * run on workers, a shared arena costs atomic code paths and an up-front reservation for nothing.
 */
export function sharedMemoryEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHARED_MEMORY_KEY) === "on";
  } catch {
    return false;
  }
}
const WORKER_THREADS_KEY = "retrove.workerThreads";
/**
 * Guest threads may run on execution workers only when a tester opts in (`retrove.workerThreads=on`);
 * they also need shared guest memory (`retrove.sharedMemory=on` on a cross-origin isolated page).
 */
export function workerThreadsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(WORKER_THREADS_KEY) === "on";
  } catch {
    return false;
  }
}
