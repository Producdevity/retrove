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
/** Runs guests on translated code alone, without Unicorn, when a tester opts in (`retrove.cpu=own`). */
export function ownCpuEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(CPU_KEY) === "own";
  } catch {
    return false;
  }
}
