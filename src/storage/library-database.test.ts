import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vite-plus/test";
import {
  ArchiveKind,
  Platform,
  applicationId,
  type InstalledApplication,
} from "../domain/application";
import { LibraryDatabase, LibraryStore } from "./library-database";
import { requestResult, transaction } from "./database";
const app: InstalledApplication = {
  id: applicationId(Platform.IOS, "test.library"),
  platform: Platform.IOS,
  bundleId: "test.library",
  name: "Example",
  version: "1.0",
  icon: null,
  archive: { kind: ArchiveKind.Database, key: "test-archive" },
  sourceName: "example.ipa",
  size: 0,
  importedAt: 0,
  lastPlayedAt: null,
};

describe("persistent library records", () => {
  test("app metadata and archive survive closing and reopening the database", async () => {
    const factory = new IDBFactory();
    const first = new LibraryDatabase(factory);
    const file = new File(["retained archive"], app.sourceName);
    await first.storeArchive(file, app.archive.key);
    await first.put({ ...app, size: file.size });
    await first.close();
    const reopened = new LibraryDatabase(factory);
    expect(await reopened.get(app.id)).toEqual({ ...app, size: file.size });
    expect(await (await reopened.archive(app.archive.key)).text()).toBe("retained archive");
    await reopened.close();
  });

  test("a thrown write transaction cannot partially overwrite an existing app", async () => {
    const storage = new LibraryDatabase(new IDBFactory());
    await storage.put(app);
    const db = await storage.database();
    await expect(
      transaction(db, [LibraryStore.Apps], "readwrite", async (tx) => {
        await requestResult(tx.objectStore(LibraryStore.Apps).put({ ...app, name: "Uncommitted" }));
        throw new Error("Interrupted write");
      }),
    ).rejects.toThrow("Interrupted write");
    expect(await storage.get(app.id)).toEqual(app);
    await storage.close();
  });

  test("corrupt or inconsistent metadata is rejected at the storage boundary", async () => {
    const storage = new LibraryDatabase(new IDBFactory());
    await transaction(await storage.database(), [LibraryStore.Apps], "readwrite", async (tx) => {
      await requestResult(
        tx.objectStore(LibraryStore.Apps).put({ ...app, bundleId: "different.app" }),
      );
    });
    await expect(storage.get(app.id)).rejects.toThrow("identity does not match");
    await storage.close();
  });

  test("archive disappearance reports a recoverable import action", async () => {
    const storage = new LibraryDatabase(new IDBFactory());
    await expect(storage.archive("missing")).rejects.toThrow("Import it again");
    await storage.close();
  });
});
