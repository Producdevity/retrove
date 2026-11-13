import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { expect, test } from "vite-plus/test";
import { Platform } from "../../../domain/application";
import { SaveStorage } from "../save-storage";
import { SAVE_CHUNK_BYTES } from "../records";
import { BACKUP_MANIFEST, parseManifest } from "./manifest";
import { exportSaves } from "./snapshot";
import { prepareBackup, restoreSaves } from "./restore";
import { writeZip } from "./zip-writer";
const app = {
  platform: Platform.IOS,
  bundleId: "test.game",
  name: "Test Game",
  version: "1.0",
  icon: null,
};
function storage(namespace: string) {
  return new SaveStorage(namespace, { factory: new IDBFactory(), range: IDBKeyRange, locks: null });
}
async function seed(target: SaveStorage, contents: Uint8Array = Uint8Array.of(1, 2, 3)) {
  return target.run("readwrite", async ({ paths, inodes, chunks }) => {
    const id = await inodes.add({
      linked: true,
      refs: 0,
      size: contents.length,
      created: 100,
      modified: 200,
      permissions: 0o600,
    });
    await paths.put("Documents/progress.sav", { inode: id });
    await chunks.put([id, 0], contents);
    return id;
  });
}
test("portable save backup restores bytes, sparse holes, metadata and empty directories", async () => {
  const source = storage("source"),
    target = storage("target");
  try {
    const id = await seed(source);
    await source.run("readwrite", async ({ paths, inodes, chunks }) => {
      const node = await inodes.get(id);
      if (!node) throw new Error("Missing test inode");
      await inodes.put(id, { ...node, size: SAVE_CHUNK_BYTES * 2 + 1 });
      await chunks.put([id, 2], Uint8Array.of(7));
      await paths.put("Documents/renamed", {
        dir: true,
        original: "Documents/original",
        permissions: 0o700,
      });
      const orphan = await inodes.add({ linked: false, refs: 1, size: 1 });
      await chunks.put([orphan, 0], Uint8Array.of(99));
    });
    const archive = await exportSaves(source, app);
    const prepared = await prepareBackup(archive, app);
    expect(prepared.manifest.nodes).toHaveLength(1);
    expect(prepared.bytes).toBe(SAVE_CHUNK_BYTES * 2 + 1);
    await seed(target, Uint8Array.of(8));
    await target.run("readwrite", ({ paths }) => paths.put("Documents/obsolete", { dir: true }));
    await restoreSaves(target, prepared);
    await target.run("readonly", async ({ paths, inodes, chunks }) => {
      const saved = await paths.get("Documents/progress.sav");
      if (!saved?.inode) throw new Error("Restored file missing");
      expect(await inodes.get(saved.inode)).toEqual({
        linked: true,
        refs: 0,
        size: SAVE_CHUNK_BYTES * 2 + 1,
        created: 100,
        modified: 200,
        permissions: 0o600,
      });
      expect((await chunks.get([saved.inode, 0]))?.subarray(0, 4)).toEqual(
        Uint8Array.of(1, 2, 3, 0),
      );
      expect(await chunks.get([saved.inode, 1])).toEqual(new Uint8Array(SAVE_CHUNK_BYTES));
      expect(await chunks.get([saved.inode, 2])).toEqual(Uint8Array.of(7));
      expect(await paths.get("Documents/renamed")).toEqual({
        dir: true,
        original: "Documents/original",
        permissions: 0o700,
      });
      expect(await paths.get("Documents/obsolete")).toBeUndefined();
      expect(await inodes.keys()).toEqual([saved.inode]);
    });
  } finally {
    await source.close();
    await target.close();
  }
});
test("interruption during staging preserves the old files and removes staged data", async () => {
  const source = storage("interrupted-source"),
    target = storage("interrupted-target");
  try {
    await seed(source);
    const backup = await prepareBackup(await exportSaves(source, app), app);
    const old = await seed(target, Uint8Array.of(8));
    const controller = new AbortController();
    class InterruptedBlob extends Blob {
      override slice(start?: number, end?: number, type?: string): Blob {
        controller.abort(new Error("Restore interrupted"));
        return super.slice(start, end, type);
      }
    }
    const files = new Map([...backup.files].map(([id, blob]) => [id, new InterruptedBlob([blob])]));
    await expect(restoreSaves(target, { ...backup, files }, controller.signal)).rejects.toThrow(
      "Restore interrupted",
    );
    await target.run("readonly", async ({ paths, inodes, chunks }) => {
      expect(await paths.get("Documents/progress.sav")).toEqual({ inode: old });
      expect(await chunks.get([old, 0])).toEqual(Uint8Array.of(8));
      expect(await inodes.keys()).toEqual([old]);
      expect(await chunks.keys()).toEqual([[old, 0]]);
    });
  } finally {
    await source.close();
    await target.close();
  }
});
test("backup validation rejects foreign apps, unsafe trees and mismatched file sizes", async () => {
  const source = storage("validation");
  try {
    await seed(source);
    const archive = await exportSaves(source, app);
    await expect(prepareBackup(archive, { ...app, bundleId: "other.game" })).rejects.toThrow(
      "different app",
    );
    const { manifest } = await prepareBackup(archive, app);
    expect(() =>
      parseManifest({ ...manifest, paths: [{ path: "../escape", entry: { dir: true } }] }),
    ).toThrow("Invalid guest file path");
    expect(() =>
      parseManifest({ ...manifest, paths: [{ path: "missing/child", entry: { dir: true } }] }),
    ).toThrow("parent directory");
    expect(() =>
      parseManifest({ ...manifest, paths: [...manifest.paths, ...manifest.paths] }),
    ).toThrow("Duplicate backup");
    const malformed = await writeZip([
      { path: BACKUP_MANIFEST, contents: new Blob([JSON.stringify(manifest)]) },
      { path: "data/Documents/progress.sav", contents: new Blob([Uint8Array.of(1)]) },
    ]);
    await expect(prepareBackup(malformed, app)).rejects.toThrow("size does not match");
  } finally {
    await source.close();
  }
});
