import { openZip } from "../../ios/package/ipa";
import { applicationId, type ApplicationMetadata } from "../../../domain/application";
import { SAVE_CHUNK_BYTES } from "../records";
import type { SaveStorage } from "../save-storage";
import {
  BACKUP_MANIFEST,
  MAX_MANIFEST_BYTES,
  parseManifest,
  type SaveManifest,
  type SavedNode,
} from "./manifest";
type Archive = Awaited<ReturnType<typeof openZip>>;
export interface PreparedBackup {
  readonly manifest: SaveManifest;
  readonly files: ReadonlyMap<number, Blob>;
  readonly bytes: number;
}
function checkApp(manifest: SaveManifest, app: ApplicationMetadata): void {
  if (
    applicationId(manifest.app.platform, manifest.app.bundleId) !==
    applicationId(app.platform, app.bundleId)
  )
    throw new Error("This backup belongs to a different app.");
}
async function readContents(zip: Archive, nodes: readonly SavedNode[], signal?: AbortSignal) {
  const files = new Map<number, Blob>();
  let bytes = 0;
  for (const { id, node, data } of nodes) {
    signal?.throwIfAborted();
    if (data === null) continue;
    if (zip.entries.get(data)?.size !== node.size)
      throw new Error("Backup file size does not match its manifest.");
    const contents = await zip.assetBlob(data);
    files.set(id, contents);
    bytes += contents.size;
    if (!Number.isSafeInteger(bytes)) throw new Error("Backup is too large.");
  }
  signal?.throwIfAborted();
  return { files, bytes };
}
export async function prepareBackup(
  blob: Blob,
  app: ApplicationMetadata,
  signal?: AbortSignal,
): Promise<PreparedBackup> {
  signal?.throwIfAborted();
  const zip = await openZip(blob);
  const json: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await zip.read(BACKUP_MANIFEST, { maxBytes: MAX_MANIFEST_BYTES }),
    ),
  );
  const manifest = parseManifest(json);
  checkApp(manifest, app);
  return { manifest, ...(await readContents(zip, manifest.nodes, signal)) };
}
async function stageNode(
  storage: SaveStorage,
  saved: SavedNode,
  contents: Blob | undefined,
  staged: Map<number, number>,
  signal?: AbortSignal,
): Promise<void> {
  const id = await storage.run("readwrite", ({ inodes }) =>
    inodes.add({ ...saved.node, linked: false, refs: 1 }),
  );
  staged.set(saved.id, id);
  if (saved.data === null) return;
  if (!contents || contents.size !== saved.node.size)
    throw new Error("Prepared backup is missing file contents.");
  for (let offset = 0; offset < contents.size; offset += SAVE_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(
      await contents.slice(offset, offset + SAVE_CHUNK_BYTES).arrayBuffer(),
    );
    await storage.run("readwrite", ({ chunks }) =>
      chunks.put([id, offset / SAVE_CHUNK_BYTES], bytes),
    );
  }
}
async function promote(
  storage: SaveStorage,
  manifest: SaveManifest,
  staged: ReadonlyMap<number, number>,
  signal?: AbortSignal,
): Promise<void> {
  await storage.run("readwrite", async ({ paths, inodes, chunks }) => {
    const retained = new Set(staged.values());
    for (const path of await paths.keys()) await paths.delete(path);
    for (const id of await inodes.keys()) {
      if (retained.has(id)) continue;
      await chunks.deleteInode(id);
      await inodes.delete(id);
    }
    for (const { id, node } of manifest.nodes) {
      const key = staged.get(id);
      if (key === undefined) throw new Error("Staged save inode is missing.");
      await inodes.put(key, { ...node, refs: 0, linked: true });
    }
    for (const { path, entry } of manifest.paths) {
      if (entry.inode === undefined) await paths.put(path, entry);
      else {
        const key = staged.get(entry.inode);
        if (key === undefined) throw new Error("Staged file inode is missing.");
        await paths.put(path, { ...entry, inode: key });
      }
    }
    signal?.throwIfAborted();
  });
}
async function discard(storage: SaveStorage, staged: ReadonlyMap<number, number>): Promise<void> {
  await storage.run("readwrite", async ({ inodes, chunks }) => {
    for (const id of staged.values()) {
      const node = await inodes.get(id);
      if (node?.linked) continue;
      await chunks.deleteInode(id);
      await inodes.delete(id);
    }
  });
}
export async function restoreSaves(
  storage: SaveStorage,
  backup: PreparedBackup,
  signal?: AbortSignal,
): Promise<void> {
  const manifest = parseManifest(backup.manifest);
  const staged = new Map<number, number>();
  try {
    for (const saved of manifest.nodes) {
      signal?.throwIfAborted();
      await stageNode(storage, saved, backup.files.get(saved.id), staged, signal);
    }
    signal?.throwIfAborted();
    await promote(storage, manifest, staged, signal);
  } catch (error) {
    await discard(storage, staged);
    throw error;
  }
}
