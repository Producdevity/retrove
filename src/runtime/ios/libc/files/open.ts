import { Open, Mode, RANDOM_ACCESS_BYTES, SUPPORTED_OPEN_FLAGS } from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { entryInode, storedInode } from "./stored";
import type { OpenFile } from "./types";

function openBundle(fs: FileSystem, file: OpenFile, bundle: string, flags: number): void {
  if (file.mode || flags & (Open.Create | Open.Truncate)) raise(Errno.ReadOnly);
  if (!fs.ipa.has(bundle)) {
    if (fs.bundleIsDir(bundle)) raise(Errno.IsDirectory);
    fs.missingBundlePath(bundle);
  }
  file.bundle = bundle;
  const load = fs.ipa.assetBlob?.bind(fs.ipa);
  if (!load || (fs.ipa.entries?.get(bundle)?.size ?? 0) < RANDOM_ACCESS_BYTES) return;
  let asset = fs.largeAssets.get(bundle);
  if (!asset) {
    asset = { references: 0, path: bundle, load: () => load(bundle) };
    fs.largeAssets.set(bundle, asset);
  }
  asset.references++;
  file.asset = asset;
}

function openHome(fs: FileSystem, home: string, flags: number, mode: number): Promise<number> {
  return fs.run("readwrite", async ({ paths, inodes, chunks }) => {
    const entry = await paths.get(home);
    if (entry && flags & Open.Create && flags & Open.Exclusive) raise(Errno.Exists);
    if (entry?.dir) raise(Errno.IsDirectory);
    if (!entry) {
      if (!(flags & Open.Create)) raise(Errno.NoEntry);
      await fs.requireParent(paths, home);
      const now = Date.now();
      const inode = await inodes.add({
        size: 0,
        refs: 1,
        linked: true,
        created: now,
        modified: now,
      });
      await paths.put(home, { inode });
      return inode;
    }
    const id = entryInode(entry);
    const node = await storedInode(inodes, id);
    const permissions = node.permissions ?? Mode.FileDefault;
    if (
      (mode !== Open.WriteOnly && !(permissions & Mode.OwnerRead)) ||
      (mode !== Open.ReadOnly && !(permissions & Mode.OwnerWrite))
    )
      raise(Errno.Access);
    node.refs++;
    if (flags & Open.Truncate) {
      node.size = 0;
      node.modified = Date.now();
      await chunks.deleteInode(id);
    }
    await inodes.put(id, node);
    return id;
  });
}

export async function openFile(fs: FileSystem, address: number, flags: number): Promise<number> {
  const mode = flags & Open.AccessMask;
  // Refuse unsupported flags, including advisory locks and directory descriptors.
  if (mode === Open.Invalid || (flags & Open.Truncate && !mode)) raise(Errno.Invalid);
  if (flags & ~SUPPORTED_OPEN_FLAGS) raise(Errno.NotSupported);
  const located = fs.locate(address);
  const file: OpenFile = {
    mode,
    path: located.bundle ?? located.home,
    append: !!(flags & Open.Append),
    offset: 0,
  };
  if (located.bundle !== undefined) openBundle(fs, file, located.bundle, flags);
  else {
    if (!located.home) raise(Errno.IsDirectory);
    file.inode = await openHome(fs, located.home, flags, mode);
  }
  const fd = fs.nextDescriptor++;
  fs.fds.set(fd, file);
  return fd;
}
