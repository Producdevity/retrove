import { AudioFileError, AudioFileStatus } from "./types";
import {
  bytesView,
  f64,
  streamDescription,
  tag,
  u32,
  u64,
  type StreamFormat,
} from "./audio-file-format";

const VARIABLE_MAX = 0x1ffffff;
const VARIABLE_BASE = 128;
const VARIABLE_MASK = 127;
const BITS_PER_BYTE = 8;
const PacketTableAt = { Priming: 16, Remainder: 20 } as const;
const PNFO_BYTES = 16;
const PnfoAt = { Priming: 8, Remainder: 12 } as const;

export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;
export interface PacketTable {
  count: number;
  valid: bigint;
  priming: number;
  remainder: number;
  at: number;
  bytes: number;
}
export interface PacketLayout {
  count: number;
  max: number;
  offsets?: Float64Array;
  frames?: Uint32Array;
}

function invalid(): never {
  throw new AudioFileError(AudioFileStatus.Invalid);
}

export function packetTable(
  header: DataView,
  at: number,
  bytes: number,
  count: number,
  valid: bigint,
): PacketTable {
  return {
    count,
    valid,
    priming: header.getInt32(PacketTableAt.Priming),
    remainder: header.getInt32(PacketTableAt.Remainder),
    at,
    bytes,
  };
}

async function variableLayout(
  read: ReadBytes,
  format: StreamFormat,
  table: PacketTable | undefined,
  dataSize: number,
): Promise<PacketLayout> {
  if (!table) return invalid();
  const { packetBytes, packetFrames } = format;
  const offsets = new Float64Array(table.count + 1),
    frames = packetFrames ? undefined : new Uint32Array(table.count),
    bytes = await read(table.at, table.bytes);
  let position = 0,
    max = packetBytes;
  const variable = (): number => {
    let value = 0,
      byte: number;
    do {
      if (position >= bytes.length || value > VARIABLE_MAX) invalid();
      byte = bytes[position++] ?? 0;
      value = value * VARIABLE_BASE + (byte & VARIABLE_MASK);
    } while (byte & VARIABLE_BASE);
    return value;
  };
  for (let index = 0; index < table.count; index++) {
    const size = packetBytes || variable();
    if (frames) frames[index] = variable();
    offsets[index + 1] = (offsets[index] ?? 0) + size;
    max = Math.max(max, size);
  }
  if ((offsets[table.count] ?? 0) > dataSize) invalid();
  return frames
    ? { count: table.count, max, offsets, frames }
    : { count: table.count, max, offsets };
}

export async function packetLayout(
  read: ReadBytes,
  format: StreamFormat,
  table: PacketTable | undefined,
  dataSize: number,
): Promise<PacketLayout> {
  const { packetBytes, packetFrames } = format;
  if (!packetBytes || !packetFrames) return variableLayout(read, format, table, dataSize);
  const count = table?.count ?? Math.floor(dataSize / packetBytes);
  if (!Number.isSafeInteger(count) || count * packetBytes > dataSize) invalid();
  return { count, max: packetBytes };
}

export function fileProperties(
  type: string,
  format: StreamFormat,
  dataSize: number,
  dataAt: number,
  layout: PacketLayout,
  table: PacketTable | undefined,
  cookie: Uint8Array | undefined,
): Map<number, Uint8Array> {
  const frameCount = Number(table?.valid ?? layout.count * format.packetFrames),
    duration = frameCount / format.rate;
  const props = new Map<number, Uint8Array>(
    (
      [
        ["ffmt", u32(tag(type))],
        ["dfmt", streamDescription(format)],
        ["bcnt", u64(BigInt(dataSize))],
        ["pcnt", u64(BigInt(layout.count))],
        ["psze", u32(layout.max)],
        ["pkub", u32(layout.max)],
        ["doff", u64(BigInt(dataAt))],
        ["edur", f64(duration)],
        ["brat", u32(duration ? Math.round((dataSize * BITS_PER_BYTE) / duration) : 0)],
      ] as const
    ).map(([name, value]) => [tag(name), value]),
  );
  if (cookie) props.set(tag("mgic"), cookie);
  if (table) {
    const bytes = new Uint8Array(PNFO_BYTES),
      view = bytesView(bytes);
    view.setBigInt64(0, table.valid, true);
    view.setInt32(PnfoAt.Priming, table.priming, true);
    view.setInt32(PnfoAt.Remainder, table.remainder, true);
    props.set(tag("pnfo"), bytes);
  }
  return props;
}
