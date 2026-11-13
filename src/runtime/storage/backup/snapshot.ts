import type { ApplicationMetadata } from "../../../domain/application";
import { SAVE_CHUNK_BYTES } from "../records";
import type { SaveStorage } from "../save-storage";
import type { SaveStores } from "../stores";
import { BACKUP_MANIFEST, createManifest, type SavedNode, type SavedPath } from "./manifest";
import { writeZip, type ZipMember } from "./zip-writer";
async function fileContents(stores: SaveStores, id: number, size: number): Promise<Blob> {
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < size; offset += SAVE_CHUNK_BYTES) {
    const count = Math.min(SAVE_CHUNK_BYTES, size - offset);
    const chunk = await stores.chunks.get([id, offset / SAVE_CHUNK_BYTES]);
    const bytes = new Uint8Array(count);
    if (chunk) bytes.set(chunk.subarray(0, count));
    parts.push(bytes);
  }
  return new Blob(parts);
}
async function snapshot(stores: SaveStores, signal?: AbortSignal) {
  const paths: SavedPath[] = [],
    nodes: SavedNode[] = [],
    files: ZipMember[] = [];
  const seen = new Set<number>();
  for (const path of await stores.paths.keys()) {
    signal?.throwIfAborted();
    const entry = await stores.paths.get(path);
    if (!entry) throw new Error("Save file disappeared during backup.");
    paths.push({ path, entry });
    if (entry.dir) files.push({ path: `data/${path}/`, contents: new Blob() });
    if (entry.inode === undefined || seen.has(entry.inode)) continue;
    seen.add(entry.inode);
    const node = await stores.inodes.get(entry.inode);
    if (!node || !node.linked) throw new Error("Save file has no linked inode.");
    const data = node.dir ? null : `data/${path}`;
    nodes.push({ id: entry.inode, node: { ...node, refs: 0 }, data });
    if (data !== null)
      files.push({ path: data, contents: await fileContents(stores, entry.inode, node.size ?? 0) });
  }
  return { paths, nodes, files };
}
export async function exportSaves(
  storage: SaveStorage,
  app: ApplicationMetadata,
  signal?: AbortSignal,
): Promise<Blob> {
  const { paths, nodes, files } = await storage.run("readonly", (stores) =>
    snapshot(stores, signal),
  );
  const manifest = createManifest(app, paths, nodes);
  return writeZip(
    [{ path: BACKUP_MANIFEST, contents: new Blob([JSON.stringify(manifest)]) }, ...files],
    signal,
  );
}
