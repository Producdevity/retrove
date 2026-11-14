import { requestResult, transaction } from "../database";
import { SaveDatabase } from "../../runtime/storage/names";
import { SaveStore, inode } from "../../runtime/storage/records";
import { preferenceNamespaces, removeGuestPreferences } from "../guest-keys";
export interface SavedAppData {
  readonly namespace: string;
  readonly bytes: number | undefined;
  readonly files: number | undefined;
}
export class SavedData {
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly preferences: Storage = localStorage,
    private readonly locks: LockManager = navigator.locks,
  ) {}
  async namespaces(): Promise<string[]> {
    if (typeof this.factory.databases !== "function")
      throw new Error("This browser cannot list stored app data.");
    const names = (await this.factory.databases()).flatMap((value) =>
      value.name?.startsWith(SaveDatabase.Prefix)
        ? [value.name.slice(SaveDatabase.Prefix.length)]
        : [],
    );
    return [...new Set([...names, ...preferenceNamespaces(this.preferences)])].sort();
  }
  async inspect(namespace: string): Promise<SavedAppData> {
    const exists = (await this.factory.databases()).some(
      (value) => value.name === SaveDatabase.Prefix + namespace,
    );
    if (!exists) return { namespace, bytes: 0, files: 0 };
    const request = this.factory.open(SaveDatabase.Prefix + namespace);
    request.onupgradeneeded = () => request.transaction?.abort();
    let db: IDBDatabase | undefined;
    try {
      db = await requestResult(request);
      const sizes = await transaction(db, [SaveStore.Inodes], "readonly", async (tx) => {
        const values: unknown = await requestResult(tx.objectStore(SaveStore.Inodes).getAll());
        if (!Array.isArray(values)) throw new Error("Invalid app data index.");
        return values.map((value) => inode(value)).filter((value) => !value.dir);
      });
      return {
        namespace,
        bytes: sizes.reduce((total, value) => total + (value.size ?? 0), 0),
        files: sizes.length,
      };
    } catch {
      return { namespace, bytes: undefined, files: undefined };
    } finally {
      db?.close();
    }
  }
  remove(
    namespace: string,
    knownNamespaces: readonly string[],
    blocked: (message: string) => void = () => {},
  ): Promise<void> {
    return this.locks.request(
      SaveDatabase.LeasePrefix + namespace,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "Close this app and its save tools in other windows before deleting its data.",
          );
        const request = this.factory.deleteDatabase(SaveDatabase.Prefix + namespace);
        request.onblocked = () =>
          blocked("Close other Retrove windows to finish removing saved data.");
        await requestResult(request);
        removeGuestPreferences(this.preferences, namespace, knownNamespaces);
      },
    );
  }
  clearPreferences(): void {
    removeGuestPreferences(this.preferences);
  }
}
