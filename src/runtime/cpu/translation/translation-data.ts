import { sha256 } from "./digest";
import {
  translationDatabase,
  type TranslationDatabase,
  type TranslationSummary,
} from "./translation-store";

export type { TranslationSummary } from "./translation-store";

/** Translated code kept between launches, as the library manages it. */
export interface TranslationData {
  removeApp(bundleId: string): Promise<void>;
  clear(): Promise<void>;
  summary(): Promise<TranslationSummary>;
}
/** Keys are a digest of the bundle ID so they stay inside the module key ranges; undefined on insecure origins. */
export async function translationAppKey(bundleId: unknown): Promise<string | undefined> {
  if (typeof bundleId !== "string" || !bundleId) return undefined;
  try {
    return await sha256(new TextEncoder().encode(bundleId));
  } catch {
    return undefined;
  }
}
export class BrowserTranslationData implements TranslationData {
  readonly #database: TranslationDatabase | undefined;
  constructor(database: TranslationDatabase | undefined = translationDatabase()) {
    this.#database = database;
  }
  async removeApp(bundleId: string): Promise<void> {
    const key = await translationAppKey(bundleId);
    if (key) await this.#database?.removeApp(key);
  }
  async clear(): Promise<void> {
    await this.#database?.clear();
  }
  async summary(): Promise<TranslationSummary> {
    return (await this.#database?.summary()) ?? { apps: 0, modules: 0, bytes: 0 };
  }
}
export const noTranslationData: TranslationData = {
  removeApp: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  summary: () => Promise.resolve({ apps: 0, modules: 0, bytes: 0 }),
};
