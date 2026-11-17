import { sha256 } from "./digest";
import { decodeProfile, type TranslationProfile } from "./translation-profile";
import { TranslationStore, translationDatabase } from "./translation-store";

const database = translationDatabase();

/** Identifies an executable's translation profile; undefined where digests are unavailable (insecure origins). */
export async function translationProfileKey(
  executable: Uint8Array<ArrayBuffer>,
): Promise<string | undefined> {
  try {
    return await sha256(executable);
  } catch {
    return undefined;
  }
}
export async function loadTranslationProfile(key: string): Promise<TranslationProfile | undefined> {
  try {
    return decodeProfile(await database?.get(TranslationStore.Profiles, key));
  } catch {
    return undefined;
  }
}
export function saveTranslationProfile(key: string, profile: TranslationProfile): void {
  if (!database) return;
  database
    .database()
    .then((db) => database.put(db, TranslationStore.Profiles, key, profile))
    .catch(() => undefined);
}
