import { virtualInode, type DirectoryEntry, type FileStat, type Inode } from "../file-metadata";
import type { Inode as StoredInode, PathEntry } from "../../../storage/records";
import { DIRECTORY_LINKS, Device, Mode } from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { parentPath } from "./paths";
import { entryInode, storedInode } from "./stored";
import type { Located } from "./types";

export function homeInode(path: string, item: PathEntry): Inode {
  return item.inode ?? virtualInode(item.original ?? path);
}

function bundleStat(fs: FileSystem, path: string): FileStat {
  const { ipa } = fs;
  const entry = ipa.entries?.get(path);
  if (entry || ipa.has(path))
    return {
      device: Device.Bundle,
      inode: virtualInode(path),
      size: entry?.size ?? 0,
      mode: Mode.Regular | (path === ipa.executablePath ? Mode.BundleExecutable : Mode.BundleFile),
      modified: entry?.modified ?? 0,
    };
  if (!fs.bundleIsDir(path)) fs.missingBundlePath(path);
  return {
    device: Device.Bundle,
    inode: virtualInode(path),
    mode: Mode.Directory | Mode.BundleDirectory,
    links: DIRECTORY_LINKS,
    size: 0,
  };
}

function saveStat(inode: number, node: StoredInode): FileStat {
  return {
    device: Device.Save,
    inode,
    mode: Mode.Regular | (node.permissions ?? Mode.FileDefault),
    size: node.size ?? 0,
    links: node.linked ? 1 : 0,
    modified: node.modified ?? 0,
    created: node.created ?? 0,
  };
}

export async function descriptorStat(fs: FileSystem, fd: number): Promise<FileStat> {
  if (fs.isStandard(fd))
    return {
      device: Device.Standard,
      inode: fd,
      mode: Mode.Character | Mode.StandardDevice,
      size: 0,
    };
  const file = fs.fdFor(fd);
  if (file.device)
    return { device: Device.Standard, inode: fd, mode: Mode.Socket | Mode.StandardDevice, size: 0 };
  if (file.bundle) return bundleStat(fs, file.bundle);
  const id = file.inode;
  if (id === undefined) throw new Error("Descriptor has no inode.");
  return fs.run("readonly", async ({ inodes }) => saveStat(id, await storedInode(inodes, id)));
}

export async function pathStat(fs: FileSystem, located: Located): Promise<FileStat> {
  if (located.bundle !== undefined) return bundleStat(fs, located.bundle);
  const home = located.home;
  if (!home)
    return {
      device: Device.Save,
      inode: virtualInode(""),
      mode: Mode.Directory | Mode.DirectoryDefault,
      links: DIRECTORY_LINKS,
      size: 0,
    };
  return fs.run("readonly", async ({ paths, inodes }) => {
    const item = await paths.get(home);
    if (!item) raise(Errno.NoEntry);
    if (item.dir)
      return {
        device: Device.Save,
        inode: homeInode(home, item),
        mode: Mode.Directory | (item.permissions ?? Mode.DirectoryDefault),
        links: DIRECTORY_LINKS,
        size: 0,
        modified: item.modified ?? 0,
        created: item.created ?? 0,
      };
    const id = entryInode(item);
    return saveStat(id, await storedInode(inodes, id));
  });
}

function bundleEntries(fs: FileSystem, bundle: string): DirectoryEntry[] {
  const children = fs.bundleIndex().get(bundle);
  if (!children) {
    if (fs.ipa.has(bundle)) raise(Errno.NotDirectory);
    fs.missingBundlePath(bundle);
  }
  const up = bundle === fs.ipa.bundlePath ? fs.ipa.bundlePath : parentPath(bundle);
  return [
    { name: ".", dir: true, inode: virtualInode(bundle) },
    { name: "..", dir: true, inode: virtualInode(up) },
    ...children.values(),
  ];
}

function homeEntries(fs: FileSystem, folder: string): Promise<DirectoryEntry[]> {
  return fs.run("readonly", async ({ paths }) => {
    const self = folder ? await paths.get(folder) : { dir: true };
    if (!self) raise(Errno.NoEntry);
    if (!self.dir) raise(Errno.NotDirectory);
    const up = folder.includes("/") ? parentPath(folder) : "";
    const above = up ? await paths.get(up) : { dir: true };
    if (!above) throw new Error("Guest parent directory is missing.");
    const contents: DirectoryEntry[] = [
      { name: ".", dir: true, inode: homeInode(folder, self) },
      { name: "..", dir: true, inode: homeInode(up, above) },
    ];
    const prefix = folder ? `${folder}/` : "";
    for (const path of await paths.keys()) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length);
      if (!name || name.includes("/")) continue;
      const item = await paths.get(path);
      if (!item) throw new Error("Guest directory entry disappeared.");
      contents.push({ name, dir: !!item.dir, inode: homeInode(path, item) });
    }
    return contents;
  });
}

export async function directoryEntries(
  fs: FileSystem,
  located: Located,
): Promise<DirectoryEntry[]> {
  if (located.bundle !== undefined) return bundleEntries(fs, located.bundle);
  return homeEntries(fs, located.home);
}
