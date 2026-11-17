import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { LibraryDatabase } from "../library-database";
import { SavedData } from "./saved-data";
import { StorageManagement } from "./service";
import { withApplicationSession } from "../../runtime/session-lock";
import { withArchiveMutation } from "../archive-maintenance";
import { SaveStorage } from "../../runtime/storage/save-storage";
import { BrowserTranslationData } from "../../runtime/cpu/translation/translation-data";
import { TranslationDatabase } from "../../runtime/cpu/translation/translation-store";
import {
  applicationId,
  Platform,
  type InstalledApplication,
  type ArchiveReference,
} from "../../domain/application";
type Granted<T> = (lock: Lock | null) => T | PromiseLike<T>;
class ScopedLocks implements LockManager {
  private readonly prefix = crypto.randomUUID();
  query(): Promise<LockManagerSnapshot> {
    return navigator.locks.query();
  }
  request<T>(name: string, callback: Granted<T>): Promise<T>;
  request<T>(name: string, options: LockOptions, callback: Granted<T>): Promise<T>;
  request<T>(name: string, options: LockOptions | Granted<T>, callback?: Granted<T>): Promise<T> {
    if (typeof options === "function") return navigator.locks.request(this.prefix + name, options);
    if (!callback) throw new Error("Missing lock callback");
    return navigator.locks.request(this.prefix + name, options, callback);
  }
}
export class TestStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  clear(): void {
    this.values.clear();
  }
}
export function storageFixture() {
  const factory = new IDBFactory(),
    db = new LibraryDatabase(factory),
    preferences = new TestStorage(),
    locks = new ScopedLocks(),
    saves = new SavedData(factory, preferences, locks);
  const state = { failRemoval: false, filesCleared: 0 };
  const archives = {
    list: async () => (await db.archiveKeys()).map((key) => ({ kind: "indexeddb" as const, key })),
    read: (reference: ArchiveReference) => db.archive(reference.key),
    remove: async (reference: ArchiveReference) => {
      if (state.failRemoval) throw new Error("Archive removal failed");
      await db.removeArchive(reference.key);
    },
    clearFiles: () => {
      state.filesCleared++;
      return Promise.resolve();
    },
  };
  const environment = {
    mutateArchive: <T>(id: InstalledApplication["id"], operation: () => Promise<T>) =>
      withApplicationSession(id, () => withArchiveMutation(operation, locks), locks),
  };
  const translationDatabase = new TranslationDatabase(factory),
    translations = new BrowserTranslationData(translationDatabase);
  const manager = new StorageManagement(db, archives, saves, environment, locks, translations);
  const app = async (namespace: string): Promise<InstalledApplication> => {
    const archive = await db.storeArchive(new File(["archive"], "test.ipa"), crypto.randomUUID());
    const value: InstalledApplication = {
      id: applicationId(Platform.IOS, namespace),
      bundleId: namespace,
      platform: Platform.IOS,
      name: namespace,
      version: "1",
      archive,
      sourceName: "test.ipa",
      size: 7,
      icon: null,
      importedAt: 0,
      lastPlayedAt: null,
    };
    await db.put(value);
    return value;
  };
  const save = async (namespace: string) => {
    const storage = new SaveStorage(namespace, { factory, locks, range: IDBKeyRange });
    await storage.run("readwrite", async ({ inodes, paths, chunks }) => {
      const id = await inodes.add({ size: 3, linked: true, refs: 0 });
      await paths.put("Documents/save", { inode: id });
      await chunks.put([id, 0], Uint8Array.of(1, 0, 1));
    });
    await storage.close();
  };
  return {
    factory,
    db,
    preferences,
    locks,
    saves,
    state,
    archives,
    manager,
    app,
    save,
    translationDatabase,
  };
}
