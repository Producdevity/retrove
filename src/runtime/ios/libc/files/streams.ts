import { readString, write32 } from "../../../memory/guest-memory";
import { Open, STANDARD_STREAM_SYMBOLS, Standard, Stream, WORD_BYTES } from "./constants";
import { Errno, FileError, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { closeDescriptor, immediate, readDescriptor, writeDescriptor } from "./transfer";
import type { GuestStream } from "./types";

const StatusField = { Flags: 0, Descriptor: 2 } as const;
const STREAM_ACCESS_FLAGS = [Stream.ReadFlag, Stream.WriteFlag, Stream.ReadWriteFlag] as const;
const STREAM_MODE = /^[rwa](?:b?\+?|\+b)$/;
const OPEN_FLAGS_BY_MODE: Readonly<Record<string, number>> = {
  r: Open.ReadOnly,
  w: Open.Create | Open.Truncate,
  a: Open.Create | Open.Append,
};

export function setStreamStatus(fs: FileSystem, pointer: number, stream: GuestStream): void {
  const flags =
    stream.flags | (stream.eof ? Stream.EofFlag : 0) | (stream.error ? Stream.ErrorFlag : 0);
  const bytes = new Uint8Array(WORD_BYTES),
    view = new DataView(bytes.buffer);
  view.setUint16(StatusField.Flags, flags, true);
  view.setInt16(StatusField.Descriptor, stream.fd, true);
  fs.cpu.write(pointer + Stream.Status, bytes);
}

export function installStandardStreams(fs: FileSystem, data: Map<string, number>): void {
  for (const [fd, symbol] of STANDARD_STREAM_SYMBOLS.entries()) {
    const pointer = fs.heap.zero(Stream.Bytes),
      slot = fs.heap.zero(WORD_BYTES);
    if (!pointer || !slot) throw Error("Guest heap exhausted creating standard streams");
    const stream: GuestStream = {
      fd,
      flags: fd === Standard.Input ? Stream.ReadFlag : Stream.WriteFlag,
      eof: false,
      error: false,
    };
    fs.streams.set(pointer, stream);
    setStreamStatus(fs, pointer, stream);
    write32(fs.cpu, slot, pointer);
    data.set(symbol, slot);
  }
}

export async function streamRead(
  fs: FileSystem,
  stream: GuestStream,
  destination: number,
  count: number,
): Promise<number> {
  if (!count) return 0;
  let copied = 0;
  if (stream.pushback !== undefined) {
    fs.cpu.write(destination, Uint8Array.of(stream.pushback));
    delete stream.pushback;
    copied = 1;
  }
  return (
    copied + immediate(await readDescriptor(fs, stream.fd, destination + copied, count - copied))
  );
}

export function streamMode(fs: FileSystem, address: number): { access: number; flags: number } {
  const mode = readString(fs.cpu, address);
  if (!STREAM_MODE.test(mode)) raise(Errno.Invalid);
  const access = mode.includes("+")
    ? Open.ReadWrite
    : mode.startsWith("r")
      ? Open.ReadOnly
      : Open.WriteOnly;
  return { access, flags: access | (OPEN_FLAGS_BY_MODE[mode.slice(0, 1)] ?? 0) };
}

export async function newStream(
  fs: FileSystem,
  fd: number,
  access: number,
  pointer: number = fs.heap.zero(Stream.Bytes),
): Promise<number> {
  if (!pointer) {
    await closeDescriptor(fs, fd);
    raise(Errno.NoMemory);
  }
  const stream: GuestStream = {
    fd,
    flags: STREAM_ACCESS_FLAGS[access] ?? 0,
    eof: false,
    error: false,
  };
  fs.streams.set(pointer, stream);
  setStreamStatus(fs, pointer, stream);
  return pointer;
}

export async function writeBytes(fs: FileSystem, fd: number, bytes: Uint8Array): Promise<number> {
  if (
    (fd === Standard.Output || fd === Standard.Error) &&
    !fs.fds.has(fd) &&
    !fs.closedStandard.has(fd)
  ) {
    fs.log(new TextDecoder().decode(bytes));
    return bytes.length;
  }
  const pointer = fs.heap.alloc(bytes.length);
  if (!pointer) {
    fs.setErrno(Errno.NoMemory);
    return -1;
  }
  try {
    fs.cpu.write(pointer, bytes);
    return immediate(await writeDescriptor(fs, fd, pointer, bytes.length));
  } catch (error) {
    if (error instanceof FileError) {
      fs.setErrno(error.errno);
      return -1;
    }
    throw error;
  } finally {
    fs.heap.free(pointer);
  }
}
