import { DiagnosticOperation, OperationError } from "../diagnostics/operations";
import {
  ArchiveKind,
  type ApplicationId,
  type ArchiveReference,
  type InstalledApplication,
} from "../domain/application";
import type { LibraryRepository } from "../library/contracts";
import { decodeApplication } from "../library/records";
import { requestResult, transaction } from "./database";

export const LibraryStore = { Apps: "applications", Archives: "archives" } as const;
const DATABASE_NAME = "retrove.library";
const DATABASE_VERSION = 1;

export class LibraryDatabase implements LibraryRepository {
  private connection: Promise<IDBDatabase> | undefined;
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async database(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LibraryStore.Apps, { keyPath: "id" });
      request.result.createObjectStore(LibraryStore.Archives);
    };
    this.connection = requestResult(request)
      .then((db) => {
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        return db;
      })
      .catch((error: unknown) => {
        this.connection = undefined;
        throw new OperationError(DiagnosticOperation.Database, error);
      });
    return this.connection;
  }

  async list(): Promise<InstalledApplication[]> {
    return transaction(await this.database(), [LibraryStore.Apps], "readonly", async (tx) => {
      const values: unknown = await requestResult(tx.objectStore(LibraryStore.Apps).getAll());
      if (!Array.isArray(values)) throw new Error("The app library is unreadable.");
      return values.map(decodeApplication);
    });
  }

  async get(id: ApplicationId): Promise<InstalledApplication | undefined> {
    return transaction(await this.database(), [LibraryStore.Apps], "readonly", async (tx) => {
      const value: unknown = await requestResult(tx.objectStore(LibraryStore.Apps).get(id));
      return value === undefined ? undefined : decodeApplication(value);
    });
  }

  async put(app: InstalledApplication): Promise<void> {
    await transaction(await this.database(), [LibraryStore.Apps], "readwrite", async (tx) => {
      await requestResult(tx.objectStore(LibraryStore.Apps).put(app));
    });
  }

  async remove(id: ApplicationId): Promise<void> {
    await transaction(await this.database(), [LibraryStore.Apps], "readwrite", async (tx) => {
      await requestResult(tx.objectStore(LibraryStore.Apps).delete(id));
    });
  }

  async storeArchive(file: File, key: string): Promise<ArchiveReference> {
    await transaction(await this.database(), [LibraryStore.Archives], "readwrite", async (tx) => {
      await requestResult(tx.objectStore(LibraryStore.Archives).put(file, key));
    });
    return { kind: ArchiveKind.Database, key };
  }

  async archive(key: string): Promise<Blob> {
    return transaction(await this.database(), [LibraryStore.Archives], "readonly", async (tx) => {
      const value: unknown = await requestResult(tx.objectStore(LibraryStore.Archives).get(key));
      if (!(value instanceof Blob))
        throw new Error(
          "This app's archive is missing. Import it again to restore access; its saves are kept separately.",
        );
      return value;
    });
  }

  async archiveKeys(): Promise<string[]> {
    return transaction(await this.database(), [LibraryStore.Archives], "readonly", async (tx) => {
      const keys = await requestResult(tx.objectStore(LibraryStore.Archives).getAllKeys());
      return keys.filter((key): key is string => typeof key === "string");
    });
  }

  async removeArchive(key: string): Promise<void> {
    await transaction(await this.database(), [LibraryStore.Archives], "readwrite", async (tx) => {
      await requestResult(tx.objectStore(LibraryStore.Archives).delete(key));
    });
  }

  async applicationKeys(): Promise<IDBValidKey[]> {
    return transaction(await this.database(), [LibraryStore.Apps], "readonly", (tx) =>
      requestResult(tx.objectStore(LibraryStore.Apps).getAllKeys()),
    );
  }
  async archiveReferences(): Promise<ArchiveReference[]> {
    return transaction(await this.database(), [LibraryStore.Apps], "readonly", async (tx) => {
      const values: unknown = await requestResult(tx.objectStore(LibraryStore.Apps).getAll());
      if (!Array.isArray(values))
        throw new Error("The app index is unreadable. Use Delete all apps & saves to reset it.");
      return values.map((value) => decodeApplication(value).archive);
    });
  }
  async reset(): Promise<void> {
    await transaction(
      await this.database(),
      [LibraryStore.Apps, LibraryStore.Archives],
      "readwrite",
      async (tx) => {
        await Promise.all(
          [LibraryStore.Apps, LibraryStore.Archives].map((name) =>
            requestResult(tx.objectStore(name).clear()),
          ),
        );
      },
    );
  }
  async close(): Promise<void> {
    if (this.connection) (await this.connection).close();
    this.connection = undefined;
  }
}
