import { expect, test } from "vite-plus/test";
import {
  ArchiveKind,
  Platform,
  type ArchiveReference,
  type InstalledApplication,
} from "../domain/application";
import { collectOrphanArchives, withArchiveMutation } from "./archive-maintenance";
function fixture() {
  const retained: ArchiveReference = { kind: ArchiveKind.FileSystem, key: "retained" };
  const orphan: ArchiveReference = { kind: ArchiveKind.Database, key: "retained" };
  const app: InstalledApplication = {
    id: "ios:test",
    platform: Platform.IOS,
    bundleId: "test",
    name: "Test",
    version: "1",
    icon: null,
    archive: retained,
    sourceName: "test.ipa",
    size: 1,
    importedAt: 0,
    lastPlayedAt: null,
  };
  const removed: ArchiveReference[] = [];
  let listings = 0;
  const archives = {
    list: () => {
      listings++;
      return Promise.resolve([retained, orphan]);
    },
    remove: (reference: ArchiveReference) => {
      removed.push(reference);
      return Promise.resolve();
    },
  };
  const library = { list: () => Promise.resolve([app]) };
  return { retained, orphan, removed, archives, library, listings: () => listings };
}
test("orphan collection retains committed archives and distinguishes storage backends", async () => {
  const state = fixture();
  expect(await collectOrphanArchives(state.library, state.archives)).toBe(1);
  expect(state.removed).toEqual([state.orphan]);
});
test("an import lease protects files until its metadata commit finishes", async () => {
  const state = fixture();
  await withArchiveMutation(async () => {
    expect(await collectOrphanArchives(state.library, state.archives)).toBe(0);
    expect(state.listings()).toBe(0);
    expect(state.removed).toEqual([]);
  });
  expect(await collectOrphanArchives(state.library, state.archives)).toBe(1);
});
test("unreadable library records prevent any archive cleanup", async () => {
  const state = fixture();
  await expect(
    collectOrphanArchives(
      { list: () => Promise.reject(new Error("Damaged records")) },
      state.archives,
    ),
  ).rejects.toThrow("Damaged records");
  expect(state.listings()).toBe(0);
  expect(state.removed).toEqual([]);
});
test("cleanup failures preserve the committed archive and release the maintenance lease", async () => {
  const state = fixture();
  await expect(
    collectOrphanArchives(state.library, {
      ...state.archives,
      remove: () => Promise.reject(new Error("Storage busy")),
    }),
  ).rejects.toThrow("unused app archives");
  expect(await withArchiveMutation(() => Promise.resolve("released"))).toBe("released");
  expect(state.removed).toEqual([]);
});
