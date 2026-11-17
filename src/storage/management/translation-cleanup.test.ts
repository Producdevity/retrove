import { expect, test } from "vite-plus/test";
import { storageFixture } from "./test-support";
import { translationAppKey } from "../../runtime/cpu/translation/translation-data";
import {
  TranslationStore,
  VERSION_SEPARATOR,
  moduleSlot,
} from "../../runtime/cpu/translation/translation-store";

async function seed(x: ReturnType<typeof storageFixture>, bundleId: string): Promise<string> {
  const key = await translationAppKey(bundleId),
    database = x.translationDatabase,
    db = await database.database();
  if (!key) throw new Error("Missing translation key");
  await database.put(db, TranslationStore.Profiles, key, { functions: [], entries: [] });
  for (const version of ["/a.js", "/b.js"])
    await database.put(
      db,
      TranslationStore.Modules,
      version + VERSION_SEPARATOR + moduleSlot(key, 0),
      1,
    );
  return key;
}

test("deleting an app deletes its translated code from every build and keeps other apps", async () => {
  const x = storageFixture(),
    first = await x.app("test.game"),
    second = await x.app("test.other");
  await seed(x, first.bundleId);
  const kept = await seed(x, second.bundleId);
  expect(await x.manager.translationSummary()).toEqual({ apps: 2, modules: 4, bytes: 32 });
  await x.manager.remove(first.id, false);
  expect(await x.manager.translationSummary()).toEqual({ apps: 1, modules: 2, bytes: 16 });
  expect(await x.translationDatabase.get(TranslationStore.Profiles, kept)).toEqual({
    functions: [],
    entries: [],
  });
  await x.db.close();
});

test("translated code can be cleared alone and is cleared with all data", async () => {
  const x = storageFixture(),
    app = await x.app("test.game");
  await seed(x, app.bundleId);
  await x.manager.clearTranslations();
  expect(await x.manager.translationSummary()).toEqual({ apps: 0, modules: 0, bytes: 0 });
  expect(await x.db.get(app.id)).toEqual(app);
  await seed(x, app.bundleId);
  await x.manager.clear();
  expect(await x.manager.translationSummary()).toEqual({ apps: 0, modules: 0, bytes: 0 });
  await x.db.close();
});

test("the summary counts the bytes of stored modules", async () => {
  const x = storageFixture(),
    app = await x.app("test.game"),
    key = await translationAppKey(app.bundleId),
    database = x.translationDatabase,
    db = await database.database();
  if (!key) throw new Error("Missing translation key");
  await database.put(
    db,
    TranslationStore.Modules,
    "/a.js" + VERSION_SEPARATOR + moduleSlot(key, 0),
    {
      job: "ab",
      translation: new Uint8Array(1000),
    },
  );
  expect(await x.manager.translationSummary()).toEqual({ apps: 0, modules: 1, bytes: 1004 });
  await x.db.close();
});
