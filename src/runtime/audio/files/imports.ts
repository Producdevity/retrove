import type { GuestArguments } from "../../ios/objc/host";
import { AUDIO_READ_CHUNK_BYTES, AudioFileStatus, audioStatus } from "./types";
import type { AudioFileImport, AudioFileRecord, AudioSource } from "./types";
const WORD_BITS = 32;
const OFFSET_BITS = 64;
const BISECTION_PARTS = 2;
const OpenArgument = { URL: 0, Permission: 1, Output: 3 } as const;
const ByteArgument = { StartLow: 2, StartHigh: 3, Count: 4, Output: 5 } as const;
const PacketArgument = {
  Bytes: 2,
  Descriptions: 3,
  StartLow: 4,
  StartHigh: 5,
  Count: 6,
  Output: 7,
} as const;
const Description = { Bytes: 16, Frames: 8, Size: 12 } as const;
const READ_PERMISSION = 1;
interface AudioFilesHost {
  source(url: number): Promise<AudioSource>;
  inspect(source: AudioSource): Promise<AudioFileRecord>;
  register(file: AudioFileRecord): number;
  lookup(pointer: number): AudioFileRecord | undefined;
  remove(pointer: number): void;
  entries(): Iterable<AudioFileRecord>;
  clear(): void;
  readWord(pointer: number): number;
  writeWord(pointer: number, value: number): void;
  write(pointer: number, bytes: Uint8Array): void;
}
function signedOffset(low: number, high: number): number {
  return Number(BigInt.asIntN(OFFSET_BITS, BigInt(low) | (BigInt(high) << BigInt(WORD_BITS))));
}
async function openURL(host: AudioFilesHost, args: GuestArguments): Promise<number> {
  const url = args(OpenArgument.URL),
    permission = args(OpenArgument.Permission),
    output = args(OpenArgument.Output);
  if (!output || !url) return AudioFileStatus.Parameter;
  host.writeWord(output, 0);
  if (permission !== READ_PERMISSION) return AudioFileStatus.Permissions;
  let source: AudioSource | undefined;
  try {
    source = await host.source(url);
    const file = await host.inspect(source);
    if (source.close) file.close = () => source?.close?.() ?? Promise.resolve();
    host.writeWord(output, host.register(file));
    return 0;
  } catch (error) {
    await source?.close?.();
    const status = audioStatus(error);
    if (status !== undefined) return status;
    throw error;
  }
}
async function readBytes(host: AudioFilesHost, args: GuestArguments): Promise<number> {
  const file = host.lookup(args(0)),
    count = args(ByteArgument.Count),
    output = args(ByteArgument.Output);
  if (!file) return AudioFileStatus.NotOpen;
  if (!count || !output) return AudioFileStatus.Parameter;
  const wanted = host.readWord(count),
    start = signedOffset(args(ByteArgument.StartLow), args(ByteArgument.StartHigh));
  host.writeWord(count, 0);
  if (!Number.isSafeInteger(start) || start < 0) return AudioFileStatus.Position;
  if (start >= file.dataSize) return AudioFileStatus.EndOfFile;
  const length = Math.min(wanted, file.dataSize - start);
  try {
    for (let at = 0; at < length; at += AUDIO_READ_CHUNK_BYTES) {
      const bytes = await file.read(
        file.dataAt + start + at,
        Math.min(AUDIO_READ_CHUNK_BYTES, length - at),
      );
      host.write(output + at, bytes);
    }
  } catch (error) {
    const status = audioStatus(error);
    if (status !== undefined) return status;
    throw error;
  }
  host.writeWord(count, length);
  return length < wanted ? AudioFileStatus.EndOfFile : 0;
}
function packetOffset(file: AudioFileRecord, index: number): number {
  return file.offsets?.[index] ?? index * file.packetBytes;
}
function packetCount(
  file: AudioFileRecord,
  start: number,
  wanted: number,
  capacity: number,
): number {
  let count = Math.min(wanted, file.count - start);
  if (!file.offsets) return Math.min(count, Math.floor(capacity / file.packetBytes));
  let low = 0,
    high = count;
  while (low < high) {
    const middle = Math.ceil((high + low) / BISECTION_PARTS);
    if (packetOffset(file, start + middle) - packetOffset(file, start) <= capacity) low = middle;
    else high = middle - 1;
  }
  return low;
}
function descriptions(
  host: AudioFilesHost,
  file: AudioFileRecord,
  start: number,
  count: number,
  first: number,
  pointer: number,
): void {
  if (!pointer || !file.offsets) return;
  const bytes = new Uint8Array(Description.Bytes * count),
    view = new DataView(bytes.buffer);
  for (let index = 0; index < count; index++) {
    const packet = start + index,
      at = Description.Bytes * index;
    view.setBigInt64(at, BigInt(packetOffset(file, packet) - first), true);
    view.setUint32(at + Description.Frames, file.frames?.[packet] ?? 0, true);
    view.setUint32(
      at + Description.Size,
      packetOffset(file, packet + 1) - packetOffset(file, packet),
      true,
    );
  }
  host.write(pointer, bytes);
}
async function readPackets(
  host: AudioFilesHost,
  args: GuestArguments,
  legacy: boolean,
): Promise<number> {
  const file = host.lookup(args(0)),
    bytesPointer = args(PacketArgument.Bytes),
    packetsPointer = args(PacketArgument.Count),
    output = args(PacketArgument.Output);
  if (!file) return AudioFileStatus.NotOpen;
  if (!bytesPointer || !packetsPointer || !output) return AudioFileStatus.Parameter;
  const wanted = host.readWord(packetsPointer),
    capacity = legacy ? Number.MAX_SAFE_INTEGER : host.readWord(bytesPointer);
  const start = signedOffset(args(PacketArgument.StartLow), args(PacketArgument.StartHigh));
  host.writeWord(bytesPointer, 0);
  host.writeWord(packetsPointer, 0);
  if (!Number.isSafeInteger(start) || start < 0) return AudioFileStatus.Position;
  if (start >= file.count) return AudioFileStatus.EndOfFile;
  const count = packetCount(file, start, wanted, capacity),
    first = packetOffset(file, start),
    length = packetOffset(file, start + count) - first;
  try {
    for (let at = 0; at < length; at += AUDIO_READ_CHUNK_BYTES)
      host.write(
        output + at,
        await file.read(file.dataAt + first + at, Math.min(AUDIO_READ_CHUNK_BYTES, length - at)),
      );
  } catch (error) {
    const status = audioStatus(error);
    if (status !== undefined) return status;
    throw error;
  }
  descriptions(host, file, start, count, first, args(PacketArgument.Descriptions));
  host.writeWord(bytesPointer, length);
  host.writeWord(packetsPointer, count);
  return 0;
}
export function audioFileReading(host: AudioFilesHost): {
  funcs: Record<string, AudioFileImport>;
  close(): Promise<void>;
} {
  return {
    funcs: {
      _AudioFileOpenURL: (args) => openURL(host, args),
      _AudioFileReadBytes: (args) => readBytes(host, args),
      _AudioFileReadPackets: (args) => readPackets(host, args, true),
      _AudioFileReadPacketData: (args) => readPackets(host, args, false),
      _AudioFileClose: (args) => {
        const file = host.lookup(args(0));
        if (!file) return AudioFileStatus.NotOpen;
        host.remove(args(0));
        return file.close ? file.close().then(() => 0) : 0;
      },
    },
    close: async () => {
      try {
        for (const file of host.entries()) await file.close?.();
      } finally {
        host.clear();
      }
    },
  };
}
