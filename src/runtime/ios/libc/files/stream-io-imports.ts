import { readCStringBytes } from "../../../memory/guest-memory";
import { Argument, type GuestArguments } from "../../objc/host";
import type { GuestImport } from "../guest-imports";
import {
  BYTE_MASK,
  LINE_READ_BYTES,
  MAX_TRANSFER_BYTES,
  NEWLINE,
  Standard,
  Stream,
  Whence,
} from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { setStreamStatus, streamRead, writeBytes } from "./streams";
import { immediate, seekDescriptor, writeDescriptor } from "./transfer";

function transfer(fs: FileSystem, doWrite: boolean): GuestImport {
  return fs.checked(async (a) => {
    const pointer = a(Argument.Fourth),
      stream = fs.streamFor(pointer),
      bytes = a(1) * a(Argument.Third);
    if (!bytes) return 0;
    if (!Number.isSafeInteger(bytes) || bytes > MAX_TRANSFER_BYTES) raise(Errno.Invalid);
    try {
      const count = doWrite
        ? immediate(await writeDescriptor(fs, stream.fd, a(0), bytes))
        : await streamRead(fs, stream, a(0), bytes);
      if (!doWrite && count < bytes) stream.eof = true;
      setStreamStatus(fs, pointer, stream);
      return Math.floor(count / a(1));
    } catch (error) {
      stream.error = true;
      setStreamStatus(fs, pointer, stream);
      throw error;
    }
  }, 0);
}

async function readLine(fs: FileSystem, a: GuestArguments): Promise<number> {
  const destination = a(0),
    limit = a(1) | 0,
    pointer = a(Argument.Third),
    stream = fs.streamFor(pointer);
  if (!destination || limit < 1) return 0;
  let used = 0;
  while (used < limit - 1) {
    const count = Math.min(LINE_READ_BYTES, limit - 1 - used);
    const n = await streamRead(fs, stream, destination + used, count);
    if (!n) {
      stream.eof = true;
      setStreamStatus(fs, pointer, stream);
      if (!used) return 0;
      break;
    }
    const newline = fs.cpu.read(destination + used, n).indexOf(NEWLINE);
    if (newline >= 0) {
      used += newline + 1;
      if (newline + 1 < n)
        await seekDescriptor(fs, stream.fd, BigInt(newline + 1 - n), Whence.Current);
      break;
    }
    used += n;
  }
  fs.cpu.write(destination + used, Uint8Array.of(0));
  return destination;
}

async function readCharacter(fs: FileSystem, pointer: number): Promise<number> {
  const stream = fs.streamFor(pointer);
  const scratch = pointer + Stream.Scratch;
  if (await streamRead(fs, stream, scratch, 1)) return fs.cpu.read(scratch, 1)[0] ?? 0;
  stream.eof = true;
  setStreamStatus(fs, pointer, stream);
  return -1;
}

export function streamIoImports(fs: FileSystem): Record<string, GuestImport> {
  const checked = fs.checked.bind(fs);
  return {
    _fread: transfer(fs, false),
    _fwrite: transfer(fs, true),
    _putchar: async (a) => {
      const ch = a(0) & BYTE_MASK;
      return (await writeBytes(fs, Standard.Output, Uint8Array.of(ch))) === 1 ? ch : -1;
    },
    _puts: async (a) => {
      const source = readCStringBytes(fs.cpu, a(0)),
        bytes = new Uint8Array(source.length + 1);
      bytes.set(source);
      bytes[source.length] = NEWLINE;
      return (await writeBytes(fs, Standard.Output, bytes)) === bytes.length ? 0 : -1;
    },
    _fputs: checked(async (a) => {
      const pointer = a(0),
        count = readCStringBytes(fs.cpu, pointer).length;
      const written = immediate(await writeDescriptor(fs, fs.streamFor(a(1)).fd, pointer, count));
      return written === count ? 0 : -1;
    }),
    _fputc: checked(async (a) => {
      const pointer = a(1),
        stream = fs.streamFor(pointer),
        ch = a(0) & BYTE_MASK;
      fs.cpu.write(pointer + Stream.Scratch, Uint8Array.of(ch));
      const written = immediate(await writeDescriptor(fs, stream.fd, pointer + Stream.Scratch, 1));
      return written === 1 ? ch : -1;
    }),
    _getc: checked((a) => readCharacter(fs, a(0))),
    _fgets: checked((a) => readLine(fs, a), 0),
  };
}
