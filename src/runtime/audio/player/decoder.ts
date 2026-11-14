import { decodeIMA4, IMA4_PACKET_BYTES, IMA4_PACKET_FRAMES } from "../codecs/ima4";
import type { AudioFileRecord, AudioSource } from "../files/types";
const Tag = {
  Format: 0x64666d74,
  PacketInfo: 0x706e666f,
  IMA4: 0x696d6134,
  PCM: 0x6c70636d,
} as const;
const Field = {
  Rate: 0,
  Format: 8,
  Flags: 12,
  PacketBytes: 16,
  PacketFrames: 20,
  FrameBytes: 24,
  Channels: 28,
  Bits: 32,
  Priming: 8,
} as const;
const PCMFlag = { Float: 1, BigEndian: 2, Signed: 4, Packed: 8, Known: 15 } as const;
const SampleBits = { Byte: 8, Short: 16, Integer: 32, Double: 64 } as const;
const MAX_DECODED_BYTES = 67108864;
const MAX_CHANNELS = 8;
const MIN_RATE = 1000;
const MAX_RATE = 384000;
const ASBD_BYTES = 40;
const BINARY_RADIX = 2;
const SIGNATURE_BYTES = 4;
export type InspectAudioFile = (source: AudioSource) => Promise<AudioFileRecord>;
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function pcmSample(data: DataView, offset: number, bits: number, flags: number): number {
  const little = !(flags & PCMFlag.BigEndian),
    signed = !!(flags & PCMFlag.Signed);
  if (flags & PCMFlag.Float) {
    if (bits === SampleBits.Integer) return data.getFloat32(offset, little);
    if (bits === SampleBits.Double) return data.getFloat64(offset, little);
  } else {
    const midpoint = BINARY_RADIX ** (bits - 1);
    if (bits === SampleBits.Byte)
      return (signed ? data.getInt8(offset) : data.getUint8(offset) - midpoint) / midpoint;
    if (bits === SampleBits.Short)
      return (
        (signed ? data.getInt16(offset, little) : data.getUint16(offset, little) - midpoint) /
        midpoint
      );
    if (bits === SampleBits.Integer)
      return (
        (signed ? data.getInt32(offset, little) : data.getUint32(offset, little) - midpoint) /
        midpoint
      );
  }
  throw new Error("Unsupported PCM sample representation.");
}
function pcm(bytes: Uint8Array, format: DataView, channels: number): Float32Array {
  const flags = format.getUint32(Field.Flags, true),
    bits = format.getUint32(Field.Bits, true),
    frameBytes = format.getUint32(Field.FrameBytes, true);
  if (
    flags & ~PCMFlag.Known ||
    !(flags & PCMFlag.Packed) ||
    frameBytes !== (channels * bits) / SampleBits.Byte ||
    !frameBytes ||
    bytes.length % frameBytes
  )
    throw new Error("Unsupported PCM frame layout.");
  const count = bytes.length / (bits / SampleBits.Byte);
  if (count * Float32Array.BYTES_PER_ELEMENT > MAX_DECODED_BYTES)
    throw new Error("Decoded audio exceeds the memory limit.");
  const samples = new Float32Array(count),
    data = view(bytes);
  for (let i = 0; i < count; i++)
    samples[i] = pcmSample(data, (i * bits) / SampleBits.Byte, bits, flags);
  return samples;
}
async function container(
  bytes: Uint8Array,
  context: BaseAudioContext,
  inspect: InspectAudioFile,
): Promise<AudioBuffer> {
  const file = await inspect({
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  });
  const descriptor = file.props.get(Tag.Format);
  if (!descriptor || descriptor.length !== ASBD_BYTES)
    throw new Error("Invalid audio stream descriptor.");
  const format = view(descriptor),
    channels = format.getUint32(Field.Channels, true),
    rate = format.getFloat64(Field.Rate, true),
    id = format.getUint32(Field.Format, true);
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > MAX_CHANNELS ||
    !Number.isFinite(rate) ||
    rate < MIN_RATE ||
    rate > MAX_RATE
  )
    throw new Error("Unsupported audio stream dimensions.");
  const payload = await file.read(file.dataAt, file.dataSize);
  let samples: Float32Array | null;
  if (id === Tag.IMA4) {
    if (
      format.getUint32(Field.PacketBytes, true) !== IMA4_PACKET_BYTES * channels ||
      format.getUint32(Field.PacketFrames, true) !== IMA4_PACKET_FRAMES
    )
      throw new Error("Invalid IMA4 packet dimensions.");
    samples = decodeIMA4(payload, channels);
  } else if (id === Tag.PCM) samples = pcm(payload, format, channels);
  else throw new Error("Unsupported CAF audio codec.");
  if (!samples) throw new Error("Invalid compressed audio packets.");
  const packetInfo = file.props.get(Tag.PacketInfo),
    table = packetInfo ? view(packetInfo) : undefined;
  const priming = table?.getInt32(Field.Priming, true) ?? 0,
    frames = table ? Number(table.getBigInt64(0, true)) : samples.length / channels;
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    priming < 0 ||
    (frames + priming) * channels > samples.length
  )
    throw new Error("Invalid audio packet frame count.");
  const buffer = context.createBuffer(channels, frames, rate);
  for (let channel = 0; channel < channels; channel++) {
    const target = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++)
      target[frame] = samples[(priming + frame) * channels + channel] ?? 0;
  }
  return buffer;
}
export async function decodePlayerAudio(
  bytes: Uint8Array,
  context: BaseAudioContext,
  inspect: InspectAudioFile,
): Promise<AudioBuffer> {
  const signature = String.fromCharCode(...bytes.subarray(0, SIGNATURE_BYTES));
  if (signature === "caff") return container(bytes, context, inspect);
  return context.decodeAudioData(Uint8Array.from(bytes).buffer);
}
