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
