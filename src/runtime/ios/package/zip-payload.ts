import { crc32 } from "../../formats/crc32";
import { Signature, slice, view, type ZipDirectory } from "./zip-directory";
import type { ReadOptions, ZipEntry } from "./zip-types";

const Local = { Bytes: 30, Flags: 6, Method: 8, NameLength: 26, ExtraLength: 28 } as const;
const ENCRYPTED_FLAG = 1;
export const Method = { Stored: 0, Deflate: 8 } as const;
const DEFAULT_MAX_READ = 0x20000000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface PayloadReaders {
  entryFor: (path: string) => ZipEntry;
  compressedBlob: (path: string) => Promise<Blob>;
  stream: (path: string) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
  read: (path: string, options?: ReadOptions) => Promise<Uint8Array<ArrayBuffer>>;
}
type Entries = ReadonlyMap<string, ZipEntry>;

function lookupEntry(entries: Entries, path: string): ZipEntry {
  const entry = entries.get(path);
  if (!entry) throw Error(`Missing ZIP entry: ${path}`);
  return entry;
}

async function payloadBlob(blob: Blob, directory: ZipDirectory, entry: ZipEntry): Promise<Blob> {
  const { path } = entry;
  if (entry.flags & ENCRYPTED_FLAG) throw Error(`Encrypted ZIP entry: ${path}`);
  if (entry.method !== Method.Stored && entry.method !== Method.Deflate) {
    throw Error(`Unsupported ZIP compression ${entry.method}`);
  }
  const local = view(await slice(blob, entry.offset, Local.Bytes));
  if (
    local.getUint32(0, true) !== Signature.Local ||
    local.getUint16(Local.Method, true) !== entry.method ||
    local.getUint16(Local.Flags, true) !== entry.flags
  ) {
    throw Error(`Invalid ZIP local header: ${path}`);
  }
  const nameSize = local.getUint16(Local.NameLength, true);
  const start = entry.offset + Local.Bytes + nameSize + local.getUint16(Local.ExtraLength, true);
  if (
    entry.compressedSize > directory.start - start ||
    (entry.method === Method.Stored && entry.compressedSize !== entry.size)
  ) {
    throw Error(`Invalid ZIP payload size: ${path}`);
  }
  if (utf8.decode(await slice(blob, entry.offset + Local.Bytes, nameSize)) !== path) {
    throw Error("Mismatched ZIP entry name");
  }
  return blob.slice(start, start + entry.compressedSize);
}

function inflate(path: string): DecompressionStream {
  try {
    return new DecompressionStream("deflate-raw");
  } catch (cause) {
    throw new Error(`This browser could not create a raw DEFLATE decoder for ${path}`, {
      cause,
    });
  }
}

function verifiedStream(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
  entry: ZipEntry,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const { path } = entry;
  let length = 0,
    crc = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(chunk, controller) {
        length += chunk.length;
        if (length > entry.size) {
          throw Error(`Inflated ZIP entry exceeds its declared size: ${path}`);
        }
        crc = crc32(crc, chunk);
        controller.enqueue(chunk);
      },
      flush() {
        if (length !== entry.size || crc !== entry.crc) {
          throw Error(`Invalid ZIP size or CRC: ${path}`);
        }
      },
    }),
  );
}

async function readAll(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
  size: number,
  onProgress: ((offset: number) => void) | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = source.getReader();
  let offset = 0;
  try {
    const bytes = new Uint8Array(size);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes.set(value, offset);
      offset += value.length;
      onProgress?.(offset);
    }
  } finally {
    reader.releaseLock();
  }
}

export function payloadReaders(
  blob: Blob,
  entries: Entries,
  directory: ZipDirectory,
): PayloadReaders {
  const entryFor = (path: string) => lookupEntry(entries, path);
  const compressedBlob = (path: string) => payloadBlob(blob, directory, entryFor(path));
  async function stream(path: string): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    const entry = entryFor(path);
    let input = (await compressedBlob(path)).stream();
    if (entry.method === Method.Deflate) input = input.pipeThrough(inflate(path));
    return verifiedStream(input, entry);
  }
  async function read(
    path: string,
    { maxBytes = DEFAULT_MAX_READ, onProgress }: ReadOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const entry = entryFor(path);
    if (entry.size > maxBytes) throw Error(`ZIP entry exceeds the read limit: ${path}`);
    return readAll(await stream(path), entry.size, onProgress);
  }
  return { entryFor, compressedBlob, stream, read };
}
