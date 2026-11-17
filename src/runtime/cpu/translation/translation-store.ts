import { requestResult } from "../../../storage/database";

export const TranslationStore = { Profiles: "profiles", Modules: "modules" } as const;
export type TranslationStore = (typeof TranslationStore)[keyof typeof TranslationStore];
const DATABASE_NAME = "retrove.translation";
const DATABASE_VERSION = 1;
/** Separates a module key's build version from its hex digest; sorts below every digest character. */
export const VERSION_SEPARATOR = "!";
/** Sorts above every hex digest character. */
const AFTER_DIGEST = "~";

/** Translation profiles (per executable) and translated modules (per build), kept apart from app data. */
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
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error("Translation storage write failed."));
    });
  }
  /** Deletes modules translated by other builds. */
  async prune(version: string): Promise<void> {
    const db = await this.database(),
      transaction = db.transaction(TranslationStore.Modules, "readwrite"),
      modules = transaction.objectStore(TranslationStore.Modules);
    modules.delete(IDBKeyRange.upperBound(version + VERSION_SEPARATOR, true));
    modules.delete(IDBKeyRange.lowerBound(version + VERSION_SEPARATOR + AFTER_DIGEST, true));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error("Translation storage cleanup failed."));
    });
  }
}
export function translationDatabase(): TranslationDatabase | undefined {
  return typeof indexedDB === "undefined" ? undefined : new TranslationDatabase(indexedDB);
}
