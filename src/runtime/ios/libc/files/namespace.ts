import type { SaveStores } from "../../../storage/stores";
import type { FileMetadata } from "../../foundation/file-attributes";
import { Mode, SAVE_ROOTS } from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { pathStat } from "./stat";
import { entryInode, storedInode } from "./stored";
import type { Located } from "./types";

async function dropLink(stores: SaveStores, path: string, item: PathItem): Promise<void> {
  await stores.paths.delete(path);
  if (item.dir) {
    if (item.inode !== undefined) await stores.inodes.delete(item.inode);
    return;
  }
  const id = entryInode(item);
  const node = await storedInode(stores.inodes, id);
  if (!node.refs) {
    await stores.inodes.delete(id);
    await stores.chunks.deleteInode(id);
  } else {
    node.linked = false;
    await stores.inodes.put(id, node);
  }
}
type PathItem = NonNullable<Awaited<ReturnType<SaveStores["paths"]["get"]>>>;

async function hasChildren(paths: SaveStores["paths"], path: string): Promise<boolean> {
  return (await paths.keys()).some((key) => key.startsWith(`${path}/`));
}

export async function removePath(fs: FileSystem, address: number, dir: boolean): Promise<number> {
  const path = fs.writable(address);
  return fs.run("readwrite", async (stores) => {
    const item = await stores.paths.get(path);
    if (!item) raise(Errno.NoEntry);
    if (!!item.dir !== dir) raise(dir ? Errno.NotDirectory : Errno.IsDirectory);
    if (dir && (await hasChildren(stores.paths, path))) raise(Errno.NotEmpty);
    await dropLink(stores, path, item);
    return 0;
  });
}

async function replaceTarget(stores: SaveStores, dst: string, item: PathItem): Promise<void> {
  const previous = await stores.paths.get(dst);
  if (!previous) return;
  if (!!previous.dir !== !!item.dir) raise(item.dir ? Errno.NotDirectory : Errno.IsDirectory);
  if (previous.dir && (await hasChildren(stores.paths, dst))) raise(Errno.NotEmpty);
  await dropLink(stores, dst, previous);
}

export async function renamePath(fs: FileSystem, from: number, to: number): Promise<number> {
  const src = fs.writable(from),
    dst = fs.writable(to);
  return fs.run("readwrite", async (stores) => {
    const { paths } = stores;
    const item = await paths.get(src);
    if (!item) raise(Errno.NoEntry);
    if (src === dst) return 0;
    if (item.dir && dst.startsWith(`${src}/`)) raise(Errno.Invalid);
    await fs.requireParent(paths, dst);
    await replaceTarget(stores, dst, item);
    const children = item.dir
      ? (await paths.keys()).filter((key) => key.startsWith(`${src}/`))
      : [];
    for (const key of [src, ...children]) {
      const moved = key === src ? item : await paths.get(key);
      if (!moved) throw new Error("Guest path disappeared during rename.");
      if (moved.dir && moved.inode === undefined) moved.original ??= key;
      await paths.put(dst + key.slice(src.length), moved);
      await paths.delete(key);
    }
    return 0;
  });
}

export async function accessPath(fs: FileSystem, address: number, mode: number): Promise<number> {
  const located = fs.locate(address);
  if (located.bundle !== undefined) {
    if (!fs.ipa.has(located.bundle) && !fs.bundleIsDir(located.bundle))
      fs.missingBundlePath(located.bundle);
    if (mode & Mode.WriteAccess) raise(Errno.ReadOnly);
  } else {
    const stat = await pathStat(fs, located);
    if ((mode & Mode.AccessBits) !== (mode & (stat.mode >>> Mode.OwnerShift) & Mode.AccessBits))
      raise(Errno.Access);
  }
  return 0;
}

export async function setMetadata(
  fs: FileSystem,
  address: number,
  update: FileMetadata,
): Promise<number> {
  const located = fs.locate(address);
  if (located.bundle !== undefined) {
    await pathStat(fs, located);
    raise(Errno.ReadOnly);
  }
  const home = located.home;
  if (!home) raise(Errno.Perm);
  return fs.run("readwrite", async ({ paths, inodes }) => {
    const item = await paths.get(home);
    if (!item) raise(Errno.NoEntry);
    if (item.dir) {
      Object.assign(item, update);
      await paths.put(home, item);
    } else {
      const id = entryInode(item);
      const node = await storedInode(inodes, id);
      Object.assign(node, update);
      await inodes.put(id, node);
    }
    return 0;
  });
}

export async function makeDirectory(fs: FileSystem, address: number): Promise<number> {
  const home = fs.locate(address).home;
  if (home === undefined) raise(Errno.ReadOnly);
  if (!home || SAVE_ROOTS.has(home)) raise(Errno.Exists);
  return fs.run("readwrite", async ({ paths, inodes }) => {
    if (await paths.get(home)) raise(Errno.Exists);
    await fs.requireParent(paths, home);
    const inode = await inodes.add({ dir: true, linked: true, refs: 0 });
    await paths.put(home, { dir: true, inode });
    return 0;
  });
}

async function requireDirectory(fs: FileSystem, located: Located): Promise<void> {
  if (located.bundle !== undefined) {
    if (fs.bundleIsDir(located.bundle)) return;
    if (fs.ipa.has(located.bundle)) raise(Errno.NotDirectory);
    fs.missingBundlePath(located.bundle);
  }
  const home = located.home;
  if (!home) return;
  const item = await fs.run("readonly", ({ paths }) => paths.get(home));
  if (!item) raise(Errno.NoEntry);
  if (!item.dir) raise(Errno.NotDirectory);
}

export async function changeDirectory(fs: FileSystem, address: number): Promise<number> {
  const located = fs.locate(address);
  await requireDirectory(fs, located);
  fs.currentDirectory = `/${located.bundle ?? located.home}`;
  return 0;
}
