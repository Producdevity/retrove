import { tag } from "../files/audio-file-format";
import { readSample } from "../queue/audio-queue-format";
import type { SampleKind } from "../queue/audio-queue-format";

export const RIOC = tag("rioc");
export const LPCM = tag("lpcm");
const DEFAULT_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_FRAME_BYTES = 4;
const BINARY = 2;
export const STREAM_BYTES = 40;
const FIELDS_AT = 8;
const FIELD_BYTES = 4;
const MIN_RATE = 8000;
const MAX_RATE = 192000;
const MAX_CHANNELS = 8;
const FLAG_MASK = 15;
const BITS_PER_BYTE = 8;
const Bits = { Byte: 8, Short: 16, Word: 32 } as const;
const SAMPLE_BITS: readonly number[] = [Bits.Byte, Bits.Short, Bits.Word];
const Flag = { Float: 1, BigEndian: 2, Signed: 4, Packed: 8 } as const;
const Field = {
  Format: 8,
  Flags: 12,
  PacketBytes: 16,
  PacketFrames: 20,
  FrameBytes: 24,
  Channels: 28,
  Bits: 32,
} as const;
const DEFAULT_FIELDS = [
  LPCM,
  Flag.Signed | Flag.Packed,
  DEFAULT_FRAME_BYTES,
  1,
  DEFAULT_FRAME_BYTES,
  DEFAULT_CHANNELS,
  Bits.Short,
  0,
];

export interface OutputFormat {
  rate: number;
  frameBytes: number;
  channels: number;
  bits: number;
  float: boolean;
  signed: boolean;
  little: boolean;
  width: number;
  sample(data: DataView, offset: number): number;
}

export function streamView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function defaultStream(): Uint8Array {
  const bytes = new Uint8Array(STREAM_BYTES),
    view = streamView(bytes);
  view.setFloat64(0, DEFAULT_RATE, true);
  for (const [index, value] of DEFAULT_FIELDS.entries())
    view.setUint32(FIELDS_AT + index * FIELD_BYTES, value, true);
  return bytes;
}

function sampleKind(bits: number, float: boolean, signed: boolean): SampleKind {
  if (float) return "Float32";
  if (bits === Bits.Byte) return signed ? "Int8" : "Uint8";
  if (bits === Bits.Short) return signed ? "Int16" : "Uint16";
  return "Int32";
}

export function parseStream(bytes: Uint8Array): OutputFormat | null {
  const view = streamView(bytes),
    rate = view.getFloat64(0, true);
  const word = (at: number) => view.getUint32(at, true);
  const flags = word(Field.Flags),
    frameBytes = word(Field.FrameBytes),
    channels = word(Field.Channels),
    bits = word(Field.Bits);
  const float = !!(flags & Flag.Float),
    signed = !!(flags & Flag.Signed),
    little = !(flags & Flag.BigEndian);
  if (
    !Number.isInteger(rate) ||
    rate < MIN_RATE ||
    rate > MAX_RATE ||
    word(Field.Format) !== LPCM ||
    flags & ~FLAG_MASK ||
    !(flags & Flag.Packed) ||
    !channels ||
    channels > MAX_CHANNELS ||
    word(Field.PacketFrames) !== 1 ||
    frameBytes !== word(Field.PacketBytes) ||
    frameBytes !== channels * (bits / BITS_PER_BYTE) ||
    !SAMPLE_BITS.includes(bits) ||
    (float && (bits !== Bits.Word || signed)) ||
    (!float && bits === Bits.Word && !signed)
  )
    return null;
  const scale = BINARY ** (bits - 1),
    kind = sampleKind(bits, float, signed);
  return {
    rate,
    frameBytes,
    channels,
    bits,
    float,
    signed,
    little,
    width: bits / BITS_PER_BYTE,
    sample: (data, offset) => {
      const value = readSample(data, kind, offset, little);
      return float
        ? Number.isFinite(value)
          ? value
          : 0
        : (signed ? value : value - scale) / scale;
    },
  };
}
