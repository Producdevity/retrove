import { decodeProfile, type TranslationProfile } from "./translation-profile";
import { TranslationStore, translationDatabase } from "./translation-store";

const database = translationDatabase();

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
