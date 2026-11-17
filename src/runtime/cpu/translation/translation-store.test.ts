import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { requestResult } from "../../../storage/database";
import {
  moduleSlot,
  TranslationDatabase,
  TranslationStore,
  VERSION_SEPARATOR,
} from "./translation-store";

const APP = "ab12";
const WASM_BYTES = 4096;
const moduleKey = (version: string, index = 0): string =>
  version + VERSION_SEPARATOR + moduleSlot(APP, index);
const translated = (): { translation: { wasm: Uint8Array } } => ({
  translation: { wasm: new Uint8Array(WASM_BYTES) },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("the summary never reads stored modules", async () => {
  const database = new TranslationDatabase(new IDBFactory()),
    db = await database.database();
  await database.put(db, TranslationStore.Modules, moduleKey("/a.js"), translated());
  const cursors = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  expect(await database.summary()).toEqual({ apps: 0, modules: 1, bytes: WASM_BYTES });
  const opened = cursors.mock.contexts.map((store) =>
    store instanceof IDBObjectStore ? store.name : undefined,
  );
  expect(opened).toContain("module-sizes");
  expect(opened).not.toContain(TranslationStore.Modules);
});

test("recorded sizes follow removal, pruning and clearing", async () => {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const database = new TranslationDatabase(new IDBFactory()),
    db = await database.database();
  await database.put(db, TranslationStore.Modules, moduleKey("/old.js"), translated());
  await database.put(db, TranslationStore.Modules, moduleKey("/new.js"), translated());
  await database.prune("/new.js");
  expect(await database.summary()).toEqual({ apps: 0, modules: 1, bytes: WASM_BYTES });
  await database.removeApp(APP);
  expect(await database.summary()).toEqual({ apps: 0, modules: 0, bytes: 0 });
  await database.put(db, TranslationStore.Modules, moduleKey("/new.js", 1), translated());
  await database.clear();
  expect(await database.summary()).toEqual({ apps: 0, modules: 0, bytes: 0 });
});

test("a version 1 database keeps its modules, which count without a size", async () => {
  const factory = new IDBFactory(),
    open = factory.open("retrove.translation", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(TranslationStore.Profiles);
    open.result.createObjectStore(TranslationStore.Modules);
  };
  const legacy = await requestResult(open);
  const write = legacy.transaction(TranslationStore.Modules, "readwrite");
  write.objectStore(TranslationStore.Modules).put(translated(), moduleKey("/a.js"));
  await new Promise((resolve) => (write.oncomplete = resolve));
  legacy.close();
  const database = new TranslationDatabase(factory);
  expect(await database.summary()).toEqual({ apps: 0, modules: 1, bytes: 0 });
});
