import { virtualInode, type DirectoryEntry } from "../file-metadata";
import type { BundleArchive } from "./types";

export type BundleDirectories = Map<string, Map<string, DirectoryEntry>>;

function addPath(dirs: BundleDirectories, root: string, path: string, isDirectory: boolean): void {
  if (!path.startsWith(`${root}/`)) return;
  let dir = root;
  const parts = path.slice(dir.length + 1).split("/");
  for (const [i, child] of parts.entries()) {
    const key = `${dir}/${child}`;
    const isDir = isDirectory || i + 1 < parts.length;
    const children = dirs.get(dir);
    if (children && !children.has(child))
      children.set(child, { name: child, dir: isDir, inode: virtualInode(key) });
    if (isDir && !dirs.has(key)) dirs.set(key, new Map());
    dir = key;
  }
}

/** Every bundle directory with its immediate children, derived from the archive's entries. */
export function buildBundleIndex(ipa: BundleArchive): BundleDirectories {
  const dirs: BundleDirectories = new Map([[ipa.bundlePath, new Map()]]);
  for (const path of ipa.entries?.keys() ?? []) addPath(dirs, ipa.bundlePath, path, false);
  for (const path of ipa.directories ?? []) addPath(dirs, ipa.bundlePath, path, true);
  return dirs;
}
