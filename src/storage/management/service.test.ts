import { expect, test } from "vite-plus/test";
import { storageFixture } from "./test-support";
import { GuestStorageKey } from "../guest-keys";
import { withApplicationSession } from "../../runtime/session-lock";
import { withArchiveMutation } from "../archive-maintenance";
import { transaction, requestResult } from "../database";
import { LibraryStore } from "../library-database";
test("unfinished archive cleanup preserves committed apps and saved data", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await x.save(app.bundleId);
  const unused = await x.db.storeArchive(new File(["partial"], "failed.ipa"), crypto.randomUUID());
  expect((await x.manager.snapshot()).unused).toEqual([{ reference: unused, bytes: 7 }]);
  expect(await x.manager.cleanUnused()).toBe(1);
  expect(await x.db.get(app.id)).toEqual(app);
  expect((await x.saves.inspect(app.bundleId)).bytes).toBe(3);
  expect(await (await x.archives.read(app.archive)).text()).toBe("archive");
  await x.db.close();
});
test("IPA-only removal retains saves and discovers them without a listed app", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await x.save(app.bundleId);
  await x.manager.remove(app.id, false);
  const state = await x.manager.snapshot();
  expect(state.apps).toEqual([]);
  expect(state.saved).toEqual([{ namespace: app.bundleId, bytes: 3, files: 1 }]);
  await x.manager.removeSaved(app.bundleId);
  expect(await x.saves.namespaces()).toEqual([]);
  await x.db.close();
});
test("full app deletion protects neighboring identifiers and unrelated preferences", async () => {
  const x = storageFixture(),
    first = await x.app("test.game"),
    second = await x.app("test.game.child");
  await x.save(first.bundleId);
  await x.save(second.bundleId);
  x.preferences.setItem(GuestStorageKey.Preferences + first.bundleId, '{"progress":1}');
  x.preferences.setItem(GuestStorageKey.Preferences + second.bundleId, '{"progress":2}');
  x.preferences.setItem(GuestStorageKey.Pasteboard + first.bundleId + ".board", "first");
  x.preferences.setItem(GuestStorageKey.Pasteboard + second.bundleId + ".board", "second");
  x.preferences.setItem("unrelated", "keep");
  await x.manager.remove(first.id, true);
  expect(await x.db.list()).toEqual([second]);
  expect(await x.saves.namespaces()).toEqual([second.bundleId]);
  expect(x.preferences.getItem(GuestStorageKey.Pasteboard + second.bundleId + ".board")).toBe(
    "second",
  );
  expect(x.preferences.getItem("unrelated")).toBe("keep");
  await x.db.close();
});
test("failed archive removal keeps the app visible and does not delete its saves", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await x.save(app.bundleId);
  x.state.failRemoval = true;
  await expect(x.manager.remove(app.id, true)).rejects.toThrow("Archive removal failed");
  expect(await x.db.get(app.id)).toEqual(app);
  expect((await x.saves.inspect(app.bundleId)).bytes).toBe(3);
  await x.db.close();
});
test("full reset clears orphan archives, malformed records and game data while keeping other databases", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await x.save(app.bundleId);
  await x.save("test.orphan");
  await x.db.storeArchive(new File(["orphan"], "failed.ipa"), crypto.randomUUID());
  await transaction(await x.db.database(), [LibraryStore.Apps], "readwrite", (tx) =>
    requestResult(tx.objectStore(LibraryStore.Apps).put({ id: "ios:broken" })),
  );
  const unrelated = x.factory.open("unrelated.database");
  await requestResult(unrelated);
  unrelated.result.close();
  x.preferences.setItem(GuestStorageKey.Preferences + app.bundleId, "{}");
  x.preferences.setItem("retrove.appearance", "dark");
  await x.manager.clear();
  expect(await x.db.list()).toEqual([]);
  expect(await x.db.archiveKeys()).toEqual([]);
  expect(await x.saves.namespaces()).toEqual([]);
  expect(x.state.filesCleared).toBe(1);
  expect((await x.factory.databases()).some((value) => value.name === "unrelated.database")).toBe(
    true,
  );
  expect(x.preferences.getItem("retrove.appearance")).toBe("dark");
  await x.db.close();
});
test("running sessions and unfinished imports block cleanup before any mutation", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await x.save(app.bundleId);
  await withApplicationSession(
    app.id,
    async () => {
      await expect(x.manager.clear()).rejects.toThrow("Close running apps");
      await expect(x.manager.remove(app.id, true)).rejects.toThrow("Close this app");
    },
    x.locks,
  );
  await withArchiveMutation(async () => {
    await expect(x.manager.clear()).rejects.toThrow("Finish imports");
    await expect(x.manager.cleanUnused()).rejects.toThrow("Finish imports");
  }, x.locks);
  expect(x.state.filesCleared).toBe(0);
  expect(await x.db.get(app.id)).toEqual(app);
  expect((await x.saves.inspect(app.bundleId)).bytes).toBe(3);
  await x.db.close();
});
