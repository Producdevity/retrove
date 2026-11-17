const TRANSLATION_KEY = "retrove.translation";
/** Translation is on unless a tester turns it off for this browser (`retrove.translation=off`). */
export function translationEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(TRANSLATION_KEY) !== "off";
  } catch {
    return true;
  }
}
