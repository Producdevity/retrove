import { requestResult } from "../../../storage/database";

export const TranslationStore = { Profiles: "profiles", Modules: "modules" } as const;
export type TranslationStore = (typeof TranslationStore)[keyof typeof TranslationStore];
const DATABASE_NAME = "retrove.translation";
const DATABASE_VERSION = 1;
/** Separates a module key's build version from its app key; sorts below every hex digit. */
export const VERSION_SEPARATOR = "!";
const SLOT_SEPARATOR = "/";
/** Sorts above every hex digit. */
const AFTER_DIGEST = "~";

export interface TranslationSummary {
  readonly apps: number;
  readonly modules: number;
}
/** Cache key for one replayed batch of an app (hex app key + batch index). */
export function moduleSlot(app: string, index: number): string {
  return app + SLOT_SEPARATOR + String(index);
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error("Translation storage transaction failed."));
  });
}

/** Translation profiles and translated modules, keyed by app; kept apart from apps and saves. */
export class TranslationDatabase {
  #connection: Promise<IDBDatabase> | undefined;
  readonly #factory: IDBFactory;
  constructor(factory: IDBFactory) {
    this.#factory = factory;
  }
  database(): Promise<IDBDatabase> {
    if (this.#connection) return this.#connection;
    const request = this.#factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TranslationStore.Profiles);
      request.result.createObjectStore(TranslationStore.Modules);
    };
    this.#connection = requestResult(request).then((db) => {
      db.onversionchange = () => {
        db.close();
        this.#connection = undefined;
      };
      return db;
    });
    this.#connection.catch(() => {
      this.#connection = undefined;
    });
    return this.#connection;
  }
  async get(store: TranslationStore, key: string): Promise<unknown> {
    const db = await this.database();
    return requestResult(db.transaction(store, "readonly").objectStore(store).get(key));
  }
  /** Starts the write before returning, so the value is cloned before the caller transfers its buffers. */
  put(db: IDBDatabase, store: TranslationStore, key: string, value: unknown): Promise<void> {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(store, "readwrite", { durability: "relaxed" });
      transaction.objectStore(store).put(value, key);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return completion(transaction);
  }
  /** Deletes modules translated by other builds. */
  async prune(version: string): Promise<void> {
    const transaction = (await this.database()).transaction(TranslationStore.Modules, "readwrite"),
      modules = transaction.objectStore(TranslationStore.Modules);
    modules.delete(IDBKeyRange.upperBound(version + VERSION_SEPARATOR, true));
    modules.delete(IDBKeyRange.lowerBound(version + VERSION_SEPARATOR + AFTER_DIGEST, true));
    await completion(transaction);
  }
  /** Deletes an app's profile and its modules from every build. */
  async removeApp(app: string): Promise<void> {
    const transaction = (await this.database()).transaction(
        [TranslationStore.Profiles, TranslationStore.Modules],
        "readwrite",
      ),
      modules = transaction.objectStore(TranslationStore.Modules),
      marker = VERSION_SEPARATOR + app + SLOT_SEPARATOR,
      keys = modules.openKeyCursor();
    transaction.objectStore(TranslationStore.Profiles).delete(app);
    keys.onsuccess = () => {
      const cursor = keys.result;
      if (!cursor) return;
      const key = cursor.primaryKey;
      if (typeof key === "string" && key.includes(marker)) modules.delete(key);
      cursor.continue();
    };
    await completion(transaction);
  }
  async clear(): Promise<void> {
    const transaction = (await this.database()).transaction(
      [TranslationStore.Profiles, TranslationStore.Modules],
      "readwrite",
    );
    transaction.objectStore(TranslationStore.Profiles).clear();
    transaction.objectStore(TranslationStore.Modules).clear();
    await completion(transaction);
  }
  async summary(): Promise<TranslationSummary> {
    const transaction = (await this.database()).transaction(
      [TranslationStore.Profiles, TranslationStore.Modules],
      "readonly",
    );
    const [apps, modules] = await Promise.all([
      requestResult(transaction.objectStore(TranslationStore.Profiles).count()),
      requestResult(transaction.objectStore(TranslationStore.Modules).count()),
    ]);
    return { apps, modules };
  }
}
export function translationDatabase(): TranslationDatabase | undefined {
  return typeof indexedDB === "undefined" ? undefined : new TranslationDatabase(indexedDB);
}
