import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { writeSave, verifySave, isolated } from "../../../tests/files-cases.mjs";
import { expect, test } from "vite-plus/test";
import { SaveStorage } from "./save-storage";
import { SAVE_CHUNK_BYTES } from "./records";
function environment() {
  return { factory: new IDBFactory(), range: IDBKeyRange, locks: null };
}
async function save(storage: SaveStorage): Promise<number> {
  return storage.run("readwrite", async ({ paths, inodes, chunks }) => {
    const id = await inodes.add({ size: 3, linked: true, refs: 0, created: 1, modified: 1 });
    await paths.put("Documents/progress.sav", { inode: id });
    await chunks.put([id, 0], Uint8Array.of(1, 2, 3));
    return id;
  });
}
test("guest files persist across storage reopen and remain isolated by app", async () => {
  const env = environment();
  const original = new SaveStorage("test.game", env),
    id = await save(original);
  await original.close();
  const reopened = new SaveStorage("test.game", env),
    other = new SaveStorage("other.game", env);
  try {
    await reopened.run("readonly", async ({ paths, inodes, chunks }) => {
      expect(await paths.get("Documents/progress.sav")).toEqual({ inode: id });
      expect((await inodes.get(id))?.size).toBe(3);
      expect(await chunks.get([id, 0])).toEqual(Uint8Array.of(1, 2, 3));
    });
    expect(
      await other.run("readonly", ({ paths }) => paths.get("Documents/progress.sav")),
    ).toBeUndefined();
  } finally {
    await reopened.close();
    await other.close();
  }
});
test("failed guest writes roll back file contents and directory changes together", async () => {
  const storage = new SaveStorage("test.rollback", environment()),
    id = await save(storage);
  try {
    await expect(
      storage.run("readwrite", async ({ paths, chunks }) => {
        await chunks.put([id, 0], Uint8Array.of(9));
        await paths.delete("Documents/progress.sav");
        await paths.put("Documents/replacement.sav", { inode: id });
        throw new Error("Interrupted save");
      }),
    ).rejects.toThrow("Interrupted save");
    await storage.run("readonly", async ({ paths, chunks }) => {
      expect(await paths.get("Documents/progress.sav")).toEqual({ inode: id });
      expect(await paths.get("Documents/replacement.sav")).toBeUndefined();
      expect(await chunks.get([id, 0])).toEqual(Uint8Array.of(1, 2, 3));
    });
  } finally {
    await storage.close();
  }
});
test("invalid guest storage records abort the entire write before commit", async () => {
  const storage = new SaveStorage("test.validation", environment()),
    id = await save(storage);
  try {
    await expect(
      storage.run("readwrite", async ({ paths, chunks }) => {
        await paths.delete("Documents/progress.sav");
        await chunks.put([id, 0], new Uint8Array(SAVE_CHUNK_BYTES + 1));
      }),
    ).rejects.toThrow("Invalid guest save chunk");
    expect(
      await storage.run("readonly", ({ paths }) => paths.get("Documents/progress.sav")),
    ).toEqual({ inode: id });
    await expect(
      storage.run("readwrite", ({ paths }) => paths.put("Documents/../escape", { inode: id })),
    ).rejects.toThrow("Invalid guest file path segment");
  } finally {
    await storage.close();
  }
});

test("Darwin save operations preserve descriptor identity on the persistent backend", async () => {
  const env = environment();
  const storage = new SaveStorage("darwin.files", env);
  const other = new SaveStorage("darwin.isolated", env);
  try {
    await writeSave(storage.namespace, storage);
    await isolated(other.namespace, other);
    await verifySave(storage.namespace, storage);
    await storage.run("readonly", async ({ inodes, chunks }) => {
      expect(await inodes.keys()).toEqual([]);
      expect(await chunks.keys()).toEqual([]);
    });
  } finally {
    await storage.close();
    await other.close();
  }
});
test("orphan recovery waits until all open runtime leases have closed", async () => {
  const env = { ...environment(), locks: navigator.locks };
  const namespace = "lease-test:" + crypto.randomUUID();
  const first = new SaveStorage(namespace, env);
  const linked = await save(first);
  const orphan = await first.run("readwrite", async ({ inodes, chunks }) => {
    const id = await inodes.add({ linked: false, refs: 1, size: 1 });
    await chunks.put([id, 0], Uint8Array.of(9));
    const live = await inodes.get(linked);
    if (!live) throw new Error("Missing test inode.");
    live.refs = 2;
    await inodes.put(linked, live);
    return id;
  });
  const second = new SaveStorage(namespace, env);
  try {
    await second.run("readonly", async ({ inodes }) => {
      expect((await inodes.get(linked))?.refs).toBe(2);
      expect((await inodes.get(orphan))?.refs).toBe(1);
    });
    await first.close();
    expect((await second.run("readonly", ({ inodes }) => inodes.get(orphan)))?.refs).toBe(1);
  } finally {
    await first.close();
    await second.close();
  }
  const recovered = new SaveStorage(namespace, env);
  try {
    await recovered.run("readonly", async ({ inodes, chunks }) => {
      expect((await inodes.get(linked))?.refs).toBe(0);
      expect(await inodes.get(orphan)).toBeUndefined();
      expect(await chunks.get([orphan, 0])).toBeUndefined();
      expect(await chunks.get([linked, 0])).toEqual(Uint8Array.of(1, 2, 3));
    });
  } finally {
    await recovered.close();
  }
});

test("renamed directories retain their original virtual inode identity", async () => {
  const env = environment();
  const storage = new SaveStorage("test.directory", env);
  await storage.run("readwrite", ({ paths }) =>
    paths.put("Library/renamed", { dir: true, original: "Documents/original" }),
  );
  await storage.close();
  const reopened = new SaveStorage("test.directory", env);
  try {
    expect(await reopened.run("readonly", ({ paths }) => paths.get("Library/renamed"))).toEqual({
      dir: true,
      original: "Documents/original",
    });
  } finally {
    await reopened.close();
  }
});

test("file and directory metadata survive reopen, including fractional and pre-epoch timestamps", async () => {
  const env = environment();
  const storage = new SaveStorage("test.timestamps", env);
  const metadata = { permissions: 0o640, created: -500, modified: 315532800125.5 };
  const id = await storage.run("readwrite", async ({ paths, inodes }) => {
    await paths.put("Documents/theme", { dir: true, ...metadata });
    const id = await inodes.add({ size: 0, linked: true, refs: 0, ...metadata });
    await paths.put("Documents/theme/file", { inode: id });
    return id;
  });
  await storage.close();
  const reopened = new SaveStorage("test.timestamps", env);
  try {
    await reopened.run("readonly", async ({ paths, inodes }) => {
      expect(await paths.get("Documents/theme")).toEqual({ dir: true, ...metadata });
      expect(await inodes.get(id)).toMatchObject(metadata);
    });
  } finally {
    await reopened.close();
  }
});
