import { DIRENT_BYTES, direntBytes } from "../file-metadata";
import type { GuestImport } from "../guest-imports";
import { DIRENT_HANDLE_HEADER, Mode } from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import {
  accessPath,
  changeDirectory,
  makeDirectory,
  removePath,
  renamePath,
  setMetadata,
} from "./namespace";
import { directoryEntries, pathStat } from "./stat";

export function closeDirectory(fs: FileSystem, handle: number): number {
  if (!fs.directoryStreams.delete(handle)) raise(Errno.BadDescriptor);
  fs.heap.free(handle);
  return 0;
}

function currentDirectory(fs: FileSystem, buffer: number, capacity: number): number {
  const bytes = new TextEncoder().encode(`${fs.currentDirectory}\0`);
  if (buffer && !capacity) raise(Errno.Invalid);
  if (capacity && capacity < bytes.length) raise(Errno.Range);
  const destination = buffer || fs.heap.zero(capacity || bytes.length);
  if (!destination) raise(Errno.NoMemory);
  fs.cpu.write(destination, bytes);
  return destination;
}

function readEntry(fs: FileSystem, handle: number): number {
  const directory = fs.directoryStreams.get(handle);
  if (!directory) raise(Errno.BadDescriptor);
  const entry = directory.entries[directory.position];
  if (!entry) return 0;
  directory.position++;
  const record = direntBytes(entry, directory.position);
  if (!record) raise(Errno.NameTooLong);
  fs.cpu.write(handle + DIRENT_HANDLE_HEADER, record);
  return handle + DIRENT_HANDLE_HEADER;
}

export function directoryImports(fs: FileSystem): Record<string, GuestImport> {
  const checked = fs.checked.bind(fs);
  return {
    _opendir: checked(
      async (a) => {
        if (!a(0)) raise(Errno.Fault);
        const entries = await directoryEntries(fs, fs.locate(a(0)));
        const handle = fs.heap.zero(DIRENT_HANDLE_HEADER + DIRENT_BYTES);
        if (!handle) raise(Errno.NoMemory);
        fs.directoryStreams.set(handle, { entries, position: 0 });
        return handle;
      },
      0,
      "opendir",
    ),
    _readdir: checked((a) => readEntry(fs, a(0)), 0),
    _closedir: checked((a) => closeDirectory(fs, a(0))),
    _access: checked((a) => accessPath(fs, a(0), a(1)), -1, "access"),
    _mkdir: checked((a) => makeDirectory(fs, a(0))),
    _chdir: checked((a) => changeDirectory(fs, a(0)), -1, "chdir"),
    _getcwd: checked((a) => currentDirectory(fs, a(0), a(1)), 0),
    _remove: checked(async (a) => {
      const stat = await pathStat(fs, fs.locate(a(0)));
      return removePath(fs, a(0), (stat.mode & Mode.TypeMask) === Mode.Directory);
    }),
    _setxattr: checked(async (a) => {
      const located = fs.locate(a(0));
      await pathStat(fs, located);
      raise(located.bundle === undefined ? Errno.NotSupported : Errno.ReadOnly);
    }),
    _getxattr: checked(async (a) => {
      await pathStat(fs, fs.locate(a(0)));
      raise(Errno.AttributeNotFound);
    }),
    _removexattr: checked(async (a) => {
      const located = fs.locate(a(0));
      await pathStat(fs, located);
      raise(located.bundle === undefined ? Errno.AttributeNotFound : Errno.ReadOnly);
    }),
    _unlink: checked((a) => removePath(fs, a(0), false)),
    _rmdir: checked((a) => removePath(fs, a(0), true)),
    _rename: checked((a) => renamePath(fs, a(0), a(1))),
    _chmod: checked((a) => setMetadata(fs, a(0), { permissions: a(1) & Mode.Permissions })),
  };
}
