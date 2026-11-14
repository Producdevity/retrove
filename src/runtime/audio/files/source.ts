import { AUDIO_READ_CHUNK_BYTES, AudioFileError, AudioFileStatus } from "./types";
import type { AudioSource } from "./types";
const FileStat = { Bytes: 108, SizeLow: 60, SizeHigh: 64 } as const;
const WORD_BITS = 32;
const WORD_MASK = 0xffffffffn;
const POSIX = { Missing: 2, Permission: 1, Access: 13 } as const;
const FileOrigin = { Start: 0 } as const;
export interface AudioFileIO {
  path(url: number): Promise<string | null>;
  errno(): number;
  allocate(bytes: number): number;
  free(pointer: number): void;
  string(value: string): number;
  read(pointer: number, length: number): Uint8Array;
  word(pointer: number): number;
  invoke(
    name: "_open" | "_close" | "_fstat" | "_read" | "_lseek",
    args: number[],
  ): Promise<number | bigint>;
}
async function fileSize(host: AudioFileIO, fd: number): Promise<number> {
  const pointer = host.allocate(FileStat.Bytes);
  if (!pointer) throw new AudioFileError(AudioFileStatus.Memory);
  try {
    if ((await host.invoke("_fstat", [fd, pointer])) !== 0)
      throw new AudioFileError(AudioFileStatus.IO);
    const size = Number(
      BigInt(host.word(pointer + FileStat.SizeLow)) |
        (BigInt(host.word(pointer + FileStat.SizeHigh)) << BigInt(WORD_BITS)),
    );
    if (!Number.isSafeInteger(size) || size < 0) throw new AudioFileError(AudioFileStatus.Invalid);
    return size;
  } finally {
    host.free(pointer);
  }
}
async function readRange(
  host: AudioFileIO,
  fd: number,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const low = Number(BigInt(offset) & WORD_MASK),
    high = Number(BigInt(offset) >> BigInt(WORD_BITS));
  const seek = await host.invoke("_lseek", [fd, low, high, FileOrigin.Start]);
  if (seek !== BigInt(offset)) throw new AudioFileError(AudioFileStatus.Position);
  const output = new Uint8Array(length),
    buffer = host.allocate(Math.min(length, AUDIO_READ_CHUNK_BYTES));
  if (!buffer) throw new AudioFileError(AudioFileStatus.Memory);
  try {
    for (let at = 0; at < length;) {
      const wanted = Math.min(length - at, AUDIO_READ_CHUNK_BYTES),
        got = await host.invoke("_read", [fd, buffer, wanted]);
      if (typeof got !== "number" || got <= 0 || got > wanted)
        throw new AudioFileError(AudioFileStatus.IO);
      output.set(host.read(buffer, got), at);
      at += got;
    }
  } finally {
    host.free(buffer);
  }
  return output;
}
export async function audioURLSource(host: AudioFileIO, url: number): Promise<AudioSource> {
  const path = await host.path(url);
  if (!path) throw new AudioFileError(AudioFileStatus.Operation);
  const pointer = host.string(path);
  let fd: number | bigint;
  try {
    fd = await host.invoke("_open", [pointer, 0]);
  } finally {
    host.free(pointer);
  }
  if (typeof fd !== "number" || fd < 0) {
    const error = host.errno();
    throw new AudioFileError(
      error === POSIX.Missing
        ? AudioFileStatus.NotFound
        : error === POSIX.Permission || error === POSIX.Access
          ? AudioFileStatus.Permissions
          : AudioFileStatus.IO,
    );
  }
  const descriptor = fd;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await host.invoke("_close", [descriptor]);
  };
  try {
    const size = await fileSize(host, descriptor);
    return {
      size,
      close,
      read: async (offset, length) => {
        if (closed) throw new AudioFileError(AudioFileStatus.NotOpen);
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset + length > size
        )
          throw new AudioFileError(AudioFileStatus.Invalid);
        return length ? readRange(host, descriptor, offset, length) : new Uint8Array();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
