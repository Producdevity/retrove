import type { GuestMemory } from "../../memory/guest-memory";
import { read32, write32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../../ios/objc/host";
import type { GuestCall, GuestHeap } from "../guest-host";
import { audioFileReading } from "./imports";
import { audioURLSource } from "./source";
import type { AudioFileIO } from "./source";
import { AUDIO_READ_CHUNK_BYTES, AudioFileStatus, audioStatus } from "./types";
import type { AudioFileImport, AudioFileRecord } from "./types";
import { AudioFileError } from "./types";
import { inspectAudioFile } from "./audio-file-inspect";
import { tag } from "./audio-file-format";

export { tag } from "./audio-file-format";
export { inspectAudioFile } from "./audio-file-inspect";

const BAD_PROPERTY = tag("pty?");
const BAD_SIZE = tag("!siz");
const HIGH_WORD = 0x100000000;
const EREAD_EOF = -39;
const Property = { File: 0, Id: 1, Size: 2, Output: 3 } as const;
const OpenArgument = { Client: 0, Reader: 1, SizeProc: 3, Output: 6 } as const;

function property(
  cpu: GuestMemory,
  files: ReadonlyMap<number, AudioFileRecord>,
  args: GuestArguments,
  info: boolean,
): number {
  const file = files.get(args(Property.File));
  if (!file || !args(Property.Size)) return AudioFileStatus.Parameter;
  const value = file.props.get(args(Property.Id));
  if (!value) return BAD_PROPERTY;
  if (info) {
    write32(cpu, args(Property.Size), value.byteLength);
    if (args(Property.Output)) write32(cpu, args(Property.Output), 0);
  } else {
    if (!args(Property.Output) || read32(cpu, args(Property.Size)) !== value.length)
      return BAD_SIZE;
    cpu.write(args(Property.Output), value);
    write32(cpu, args(Property.Size), value.length);
  }
  return 0;
}

function callbackReader(
  cpu: GuestMemory,
  heap: GuestHeap,
  guest: GuestCall,
  client: number,
  reader: number,
) {
  return async (at: number, length: number): Promise<Uint8Array> => {
    if (!length) return new Uint8Array();
    const output = new Uint8Array(length);
    for (let position = 0; position < length;) {
      const wanted = Math.min(length - position, AUDIO_READ_CHUNK_BYTES),
        scratch = heap.alloc(wanted + Uint32Array.BYTES_PER_ELEMENT);
      if (!scratch) throw new AudioFileError(AudioFileStatus.Memory);
      try {
        write32(cpu, scratch, 0);
        const offset = at + position;
        const error = Number(
          await guest(reader, [
            client,
            offset >>> 0,
            Math.floor(offset / HIGH_WORD),
            wanted,
            scratch + Uint32Array.BYTES_PER_ELEMENT,
            scratch,
          ]),
        );
        const got = read32(cpu, scratch);
        if (error && (error | 0) !== EREAD_EOF) throw new AudioFileError(error | 0);
        if (!got || got > wanted) throw new AudioFileError(AudioFileStatus.Invalid);
        output.set(cpu.read(scratch + Uint32Array.BYTES_PER_ELEMENT, got), position);
        position += got;
      } finally {
        heap.free(scratch);
      }
    }
    return output;
  };
}

export function audioFiles(
  cpu: GuestMemory,
  heap: GuestHeap,
  guest: GuestCall,
  io: AudioFileIO,
): Record<string, AudioFileImport> {
  const files = new Map<number, AudioFileRecord>();
  let next = 0;
  const reading = audioFileReading({
    source: (url) => audioURLSource(io, url),
    inspect: (source) =>
      inspectAudioFile((offset, length) => source.read(offset, length), source.size),
    register: (file) => {
      files.set(++next, file);
      return next;
    },
    lookup: (pointer) => files.get(pointer),
    remove: (pointer) => files.delete(pointer),
    entries: () => files.values(),
    clear: () => files.clear(),
    readWord: (pointer) => read32(cpu, pointer),
    writeWord: (pointer, value) => write32(cpu, pointer, value),
    write: (pointer, bytes) => cpu.write(pointer, bytes),
  });
  const api: Record<string, AudioFileImport> = {
    ...reading.funcs,
    _AudioFileOpenWithCallbacks: async (args) => {
      const client = args(OpenArgument.Client),
        reader = args(OpenArgument.Reader),
        sizeProc = args(OpenArgument.SizeProc),
        output = args(OpenArgument.Output);
      if (!output || !reader || !sizeProc) return AudioFileStatus.Parameter;
      write32(cpu, output, 0);
      const size = Number(await guest(sizeProc, [client], true));
      if (!Number.isSafeInteger(size) || size < 0) return AudioFileStatus.Invalid;
      try {
        const file = await inspectAudioFile(callbackReader(cpu, heap, guest, client, reader), size);
        files.set(++next, file);
        write32(cpu, output, next);
        return 0;
      } catch (error) {
        const status = audioStatus(error);
        if (status !== undefined) return status;
        throw error;
      }
    },
    _AudioFileGetPropertyInfo: (args) => property(cpu, files, args, true),
    _AudioFileGetProperty: (args) => property(cpu, files, args, false),
  };
  Object.defineProperty(api, "close", { value: () => reading.close() });
  return api;
}
