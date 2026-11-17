import { requestResult } from "../../../storage/database";

export const TranslationStore = { Profiles: "profiles", Modules: "modules" } as const;
export type TranslationStore = (typeof TranslationStore)[keyof typeof TranslationStore];
/** Byte size of each entry, under the entry's own key, so totals never read the entries. */
const SIZES: Readonly<Record<TranslationStore, string>> = {
  [TranslationStore.Profiles]: "profile-sizes",
  [TranslationStore.Modules]: "module-sizes",
};
const DATABASE_NAME = "retrove.translation";
/** Version 2 added the size stores; entries written by version 1 have no recorded size. */
const DATABASE_VERSION = 2;
/** Separates a module key's build version from its app key; sorts below every hex digit. */
export const VERSION_SEPARATOR = "!";
const SLOT_SEPARATOR = "/";
/** Sorts above every hex digit. */
const AFTER_DIGEST = "~";

export interface TranslationSummary {
  readonly apps: number;
  readonly modules: number;
  /** Recorded size of the stored profiles and modules; entries written before sizes were recorded count as zero. */
  readonly bytes: number;
}
const UTF16_BYTES = 2;
const NUMBER_BYTES = 8;
const MAX_DEPTH = 4;
/** Sums binary payloads, strings and numbers; structured-clone overhead is not counted. */
function storedBytes(value: unknown, depth = 0): number {
  if (typeof value === "string") return value.length * UTF16_BYTES;
  if (typeof value === "number") return NUMBER_BYTES;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>((sum, item) => sum + storedBytes(item, depth + 1), 0);
}
/** Sums a size store, whose values are plain numbers. */
function sumSizes(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return resolve(bytes);
      if (typeof current.value === "number") bytes += current.value;
      current.continue();
    };
    cursor.onerror = () =>
      reject(cursor.error ?? new Error("Translation storage could not be read."));
  });
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
      const db = request.result;
      for (const name of [...Object.values(TranslationStore), ...Object.values(SIZES)])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
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
      transaction = db.transaction([store, SIZES[store]], "readwrite", { durability: "relaxed" });
      transaction.objectStore(store).put(value, key);
      transaction.objectStore(SIZES[store]).put(storedBytes(value), key);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return completion(transaction);
  }
  /** Deletes modules translated by other builds. */
  async prune(version: string): Promise<void> {
    const sizes = SIZES[TranslationStore.Modules],
      transaction = (await this.database()).transaction(
        [TranslationStore.Modules, sizes],
        "readwrite",
      );
    for (const name of [TranslationStore.Modules, sizes]) {
      const store = transaction.objectStore(name);
      store.delete(IDBKeyRange.upperBound(version + VERSION_SEPARATOR, true));
      store.delete(IDBKeyRange.lowerBound(version + VERSION_SEPARATOR + AFTER_DIGEST, true));
    }
    await completion(transaction);
  }
  /** Deletes an app's profile and its modules from every build. */
  async removeApp(app: string): Promise<void> {
    const transaction = (await this.database()).transaction(
        [...Object.values(TranslationStore), ...Object.values(SIZES)],
        "readwrite",
      ),
      modules = transaction.objectStore(TranslationStore.Modules),
      moduleSizes = transaction.objectStore(SIZES[TranslationStore.Modules]),
      marker = VERSION_SEPARATOR + app + SLOT_SEPARATOR,
      keys = modules.openKeyCursor();
    transaction.objectStore(TranslationStore.Profiles).delete(app);
    transaction.objectStore(SIZES[TranslationStore.Profiles]).delete(app);
    keys.onsuccess = () => {
      const cursor = keys.result;
      if (!cursor) return;
      const key = cursor.primaryKey;
      if (typeof key === "string" && key.includes(marker)) {
        modules.delete(key);
        moduleSizes.delete(key);
      }
      cursor.continue();
    };
    await completion(transaction);
  }
  async clear(): Promise<void> {
    const names = [...Object.values(TranslationStore), ...Object.values(SIZES)];
    const transaction = (await this.database()).transaction(names, "readwrite");
    for (const name of names) transaction.objectStore(name).clear();
    await completion(transaction);
  }
  async summary(): Promise<TranslationSummary> {
    const transaction = (await this.database()).transaction(
      [...Object.values(TranslationStore), ...Object.values(SIZES)],
      "readonly",
    );
    const [apps, modules, profileBytes, moduleBytes] = await Promise.all([
      requestResult(transaction.objectStore(TranslationStore.Profiles).count()),
      requestResult(transaction.objectStore(TranslationStore.Modules).count()),
      sumSizes(transaction.objectStore(SIZES[TranslationStore.Profiles])),
      sumSizes(transaction.objectStore(SIZES[TranslationStore.Modules])),
    ]);
    return { apps, modules, bytes: profileBytes + moduleBytes };
  }
}
export function translationDatabase(): TranslationDatabase | undefined {
  return typeof indexedDB === "undefined" ? undefined : new TranslationDatabase(indexedDB);
}
