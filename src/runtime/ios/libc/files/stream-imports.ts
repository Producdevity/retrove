import { Argument } from "../../objc/host";
import type { GuestImport } from "../guest-imports";
import {
  BYTE_MASK,
  FIRST_FILE_DESCRIPTOR,
  LAST_BUFFER_MODE,
  MAX_TRANSFER_BYTES,
  Mode,
  Open,
  TEMPORARY_NAME_BYTES,
  TEMPORARY_NAME_RADIX,
  Whence,
  ZERO,
} from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { openFile } from "./open";
import { newStream, setStreamStatus, streamMode } from "./streams";
import { closeDescriptor, seekDescriptor } from "./transfer";

async function reopen(
  fs: FileSystem,
  address: number,
  mode: number,
  pointer: number,
): Promise<number> {
  const old = fs.streamFor(pointer);
  let path = address;
  try {
    if (!path) {
      const entry = fs.fdFor(old.fd);
      if (!entry.path) raise(Errno.BadDescriptor);
      path = fs.heap.string(`/${entry.path}`);
      if (!path) raise(Errno.NoMemory);
    }
    const { access, flags } = streamMode(fs, mode);
    await closeDescriptor(fs, old.fd);
    fs.streams.delete(pointer);
    const fd = await openFile(fs, path, flags);
    fs.fds.set(old.fd, fs.fdFor(fd));
    fs.fds.delete(fd);
    fs.closedStandard.delete(old.fd);
    return newStream(fs, old.fd, access, pointer);
  } catch (error) {
    if (fs.streams.delete(pointer)) await closeDescriptor(fs, old.fd);
    if (old.fd >= FIRST_FILE_DESCRIPTOR) fs.heap.free(pointer);
    throw error;
  } finally {
    if (path && !address) fs.heap.free(path);
  }
}

async function temporaryName(fs: FileSystem, destination: number): Promise<number> {
  const target = destination || (fs.temporaryName ||= fs.heap.zero(TEMPORARY_NAME_BYTES));
  if (!target) raise(Errno.NoMemory);
  for (;;) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const name = `tmp/B${random.toString(TEMPORARY_NAME_RADIX)}`;
    if (await fs.run("readonly", ({ paths }) => paths.get(name))) continue;
    fs.cpu.write(target, new TextEncoder().encode(`/${name}\0`));
    return target;
  }
}

async function temporaryFile(fs: FileSystem): Promise<number> {
  const now = Date.now();
  const inode = await fs.run("readwrite", ({ inodes }) =>
    inodes.add({
      size: 0,
      refs: 1,
      linked: false,
      permissions: Mode.Temporary,
      created: now,
      modified: now,
    }),
  );
  const fd = fs.nextDescriptor++;
  fs.fds.set(fd, { mode: Open.ReadWrite, inode, offset: 0, append: false });
  return newStream(fs, fd, Open.ReadWrite);
}

export function streamLifecycleImports(fs: FileSystem): Record<string, GuestImport> {
  const checked = fs.checked.bind(fs);
  return {
    _fopen: checked(
      async (a) => {
        const { access, flags } = streamMode(fs, a(1));
        return newStream(fs, await openFile(fs, a(0), flags), access);
      },
      0,
      "fopen",
    ),
    _freopen: checked((a) => reopen(fs, a(0), a(1), a(Argument.Third)), 0),
    _tmpnam: checked((a) => temporaryName(fs, a(0)), 0),
    _tmpfile: checked(() => temporaryFile(fs), 0),
    _fclose: checked(async (a) => {
      const pointer = a(0),
        fd = fs.streamFor(pointer).fd;
      await closeDescriptor(fs, fd);
      fs.streams.delete(pointer);
      if (fd >= FIRST_FILE_DESCRIPTOR) fs.heap.free(pointer);
      return 0;
    }),
    _fileno: checked((a) => fs.streamFor(a(0)).fd),
    _fflush: checked((a) => {
      if (a(0)) fs.streamFor(a(0));
      return 0;
    }),
    _setvbuf: checked((a) => {
      fs.streamFor(a(0));
      // All guest FILE writes are immediately visible on their descriptor.
      if (a(Argument.Third) > LAST_BUFFER_MODE) raise(Errno.Invalid);
      return 0;
    }),
    _feof: checked((a) => Number(fs.streamFor(a(0)).eof)),
    _ferror: checked((a) => Number(fs.streamFor(a(0)).error)),
    _clearerr: checked((a) => {
      const pointer = a(0),
        stream = fs.streamFor(pointer);
      stream.eof = stream.error = false;
      setStreamStatus(fs, pointer, stream);
    }),
    _ungetc: checked((a) => {
      const pointer = a(1),
        stream = fs.streamFor(pointer),
        ch = a(0) | 0;
      if (ch === -1 || stream.pushback !== undefined) return -1;
      stream.pushback = ch & BYTE_MASK;
      stream.eof = false;
      setStreamStatus(fs, pointer, stream);
      return stream.pushback;
    }),
    _rewind: checked(async (a) => {
      const pointer = a(0),
        stream = fs.streamFor(pointer);
      await seekDescriptor(fs, stream.fd, ZERO, Whence.Set);
      delete stream.pushback;
      stream.eof = stream.error = false;
      setStreamStatus(fs, pointer, stream);
    }),
    _fseek: checked(async (a) => {
      const pointer = a(0),
        stream = fs.streamFor(pointer);
      const adjust = stream.pushback !== undefined && a(Argument.Third) === Whence.Current ? 1 : 0;
      await seekDescriptor(fs, stream.fd, BigInt((a(1) | 0) - adjust), a(Argument.Third));
      delete stream.pushback;
      stream.eof = false;
      setStreamStatus(fs, pointer, stream);
      return 0;
    }),
    _ftell: checked((a) => {
      const stream = fs.streamFor(a(0)),
        position = fs.fdFor(stream.fd).offset - (stream.pushback !== undefined ? 1 : 0);
      if (position > MAX_TRANSFER_BYTES) raise(Errno.Overflow);
      return position;
    }),
  };
}
