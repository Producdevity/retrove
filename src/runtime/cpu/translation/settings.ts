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
/** A tester's `on`/`off` override wins; otherwise the app profile's preference decides. */
function preference(key: string, preferred: boolean): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    return stored === "on" || (stored !== "off" && preferred);
  } catch {
    return preferred;
  }
}
/**
 * Guest memory is shared when guest threads run on workers: otherwise a shared arena costs atomic
 * code paths and an up-front reservation for nothing.
 */
export function sharedMemoryEnabled(preferred = false): boolean {
  return preference(SHARED_MEMORY_KEY, preferred);
}
const WORKER_THREADS_KEY = "retrove.workerThreads";
/**
 * Guest threads run on execution workers when the app profile places them there, unless a tester
 * sets `retrove.workerThreads=off`. They also need shared guest memory on a cross-origin isolated
 * page.
 */
export function workerThreadsEnabled(preferred = false): boolean {
  return preference(WORKER_THREADS_KEY, preferred);
}
