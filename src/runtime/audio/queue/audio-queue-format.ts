import { IMA4_PACKET_BYTES, IMA4_PACKET_FRAMES, type IMA4Decoder } from "../codecs/ima4";
import { tag } from "../files/audio-file-format";

export const LINEAR_PCM = tag("lpcm");
export const IMA4 = tag("ima4");
export const FORMAT_BYTES = 40;
const FIELD_BYTES = 4;
const FIELDS_AT = 8;
const Field = {
  Id: 0,
  Flags: 1,
  PacketBytes: 2,
  PacketFrames: 3,
  FrameBytes: 4,
  Channels: 5,
  Bits: 6,
} as const;
const BINARY = 2;
const MIN_RATE = 1000;
const MAX_RATE = 384000;
const MAX_CHANNELS = 8;
const BITS_PER_BYTE = 8;
const Bits = { Byte: 8, Short: 16, Word: 32 } as const;
const FLAG_MASK = 15;
const Flag = { Float: 1, BigEndian: 2, Signed: 4, Packed: 8 } as const;
const SAMPLE_BITS: readonly number[] = [Bits.Byte, Bits.Short, Bits.Word];

export type SampleKind = "Float32" | "Int8" | "Int16" | "Int32" | "Uint8" | "Uint16" | "Uint32";

export interface QueueFormat {
  rate: number;
  id: number;
  flags: number;
  packetBytes: number;
  packetFrames: number;
  frameBytes: number;
  channels: number;
  bits: number;
}
export interface PcmCodec {
  get(view: DataView, offset: number): number;
  set(view: DataView, offset: number, value: number): void;
}

export function queueFormat(bytes: Uint8Array): QueueFormat {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index: number) => view.getUint32(FIELDS_AT + FIELD_BYTES * index, true);
  return {
    rate: view.getFloat64(0, true),
    id: word(Field.Id),
    flags: word(Field.Flags),
    packetBytes: word(Field.PacketBytes),
    packetFrames: word(Field.PacketFrames),
    frameBytes: word(Field.FrameBytes),
    channels: word(Field.Channels),
    bits: word(Field.Bits),
  };
}

export function validFormat(format: QueueFormat): boolean {
  return (
    Number.isFinite(format.rate) &&
    format.rate >= MIN_RATE &&
    format.rate <= MAX_RATE &&
    format.channels >= 1 &&
    format.channels <= MAX_CHANNELS
  );
}
export function imaFormat(format: QueueFormat): boolean {
  return (
    format.id === IMA4 &&
    format.packetFrames === IMA4_PACKET_FRAMES &&
    format.packetBytes === IMA4_PACKET_BYTES * format.channels
  );
}

export function readSample(
  view: DataView,
  kind: SampleKind,
  offset: number,
  little: boolean,
): number {
  switch (kind) {
    case "Float32":
      return view.getFloat32(offset, little);
    case "Int8":
      return view.getInt8(offset);
    case "Int16":
      return view.getInt16(offset, little);
    case "Int32":
      return view.getInt32(offset, little);
    case "Uint8":
      return view.getUint8(offset);
    case "Uint16":
      return view.getUint16(offset, little);
    case "Uint32":
      return view.getUint32(offset, little);
  }
}
function writeSample(
  view: DataView,
  kind: SampleKind,
  offset: number,
  value: number,
  little: boolean,
): void {
  switch (kind) {
    case "Float32":
      return view.setFloat32(offset, value, little);
    case "Int8":
      return view.setInt8(offset, value);
    case "Int16":
      return view.setInt16(offset, value, little);
    case "Int32":
      return view.setInt32(offset, value, little);
    case "Uint8":
      return view.setUint8(offset, value);
    case "Uint16":
      return view.setUint16(offset, value, little);
    case "Uint32":
      return view.setUint32(offset, value, little);
  }
}
function sampleKind(format: QueueFormat): SampleKind {
  if (format.flags & Flag.Float) return "Float32";
  const signed = format.flags & Flag.Signed;
  switch (format.bits) {
    case Bits.Byte:
      return signed ? "Int8" : "Uint8";
    case Bits.Short:
      return signed ? "Int16" : "Uint16";
    default:
      return signed ? "Int32" : "Uint32";
  }
}

export function pcmCodec(format: QueueFormat): PcmCodec | null {
  if (
    format.id !== LINEAR_PCM ||
    format.flags & ~FLAG_MASK ||
    !(format.flags & Flag.Packed) ||
    !SAMPLE_BITS.includes(format.bits) ||
    format.frameBytes !== (format.channels * format.bits) / BITS_PER_BYTE ||
    (format.flags & Flag.Float && format.bits !== Bits.Word)
  )
    return null;
  const kind = sampleKind(format),
    little = !(format.flags & Flag.BigEndian),
    half = BINARY ** (format.bits - 1),
    bias = format.flags & Flag.Signed ? 0 : half;
  return {
    get: (view, offset) => {
      const value = readSample(view, kind, offset, little);
      return kind === "Float32" ? value : (value - bias) / half;
    },
    set: (view, offset, value) =>
      writeSample(
        view,
        kind,
        offset,
        kind === "Float32"
          ? value
          : Math.round(Math.max(-1, Math.min(1 - 1 / half, value)) * half) + bias,
        little,
      ),
  };
}

export function decodeSamples(
  format: QueueFormat,
  bytes: Uint8Array,
  ima: IMA4Decoder | null,
): Float32Array | null {
  const codec = pcmCodec(format),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (codec) {
    const samples = new Float32Array(
      Math.floor(bytes.length / format.frameBytes) * format.channels,
    );
    for (let index = 0; index < samples.length; index++)
      samples[index] = codec.get(view, (index * format.bits) / BITS_PER_BYTE);
    return samples;
  }
  return format.id === IMA4 ? (ima?.decode(bytes) ?? null) : null;
}
