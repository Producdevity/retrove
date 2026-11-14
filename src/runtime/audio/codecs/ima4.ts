import tables from "./ima4-tables.json";
export const IMA4_PACKET_BYTES = 34;
export const IMA4_PACKET_FRAMES = 64;
const HEADER_BYTES = 2;
const INDEX_MASK = 127;
const MAX_INDEX = 88;
const NIBBLE_BITS = 4;
const NIBBLE_MASK = 15;
const DIRECTION_BIT = 8;
const MAGNITUDE_MASK = 7;
const SAMPLE_SCALE = 32768;
const DELTA_SHIFT = { Base: 3, Low: 2, Middle: 1 } as const;
const MAGNITUDE_BIT = { Low: 1, Middle: 2, High: 4 } as const;
const MAX_CHANNELS = 8;
const MAX_DECODED_BYTES = 67108864;
interface ChannelState {
  index: number;
  sample: number;
}
function packet(
  bytes: Uint8Array,
  start: number,
  output: Float32Array,
  at: number,
  channels: number,
  state: ChannelState,
): boolean {
  const header = new DataView(bytes.buffer, bytes.byteOffset + start, HEADER_BYTES).getInt16(0);
  let index = header & INDEX_MASK,
    sample = header & ~INDEX_MASK;
  if (index > MAX_INDEX) return false;
  // Packet headers omit seven predictor bits; compatible state preserves them.
  if (index === state.index && Math.abs(sample - state.sample) <= INDEX_MASK) sample = state.sample;
  for (let frame = 0; frame < IMA4_PACKET_FRAMES; frame++) {
    const byte = bytes[start + HEADER_BYTES + (frame >> 1)],
      step = tables.steps[index];
    if (byte === undefined || step === undefined) return false;
    const code = (byte >> (NIBBLE_BITS * (frame & 1))) & NIBBLE_MASK;
    const delta =
      (step >> DELTA_SHIFT.Base) +
      (code & MAGNITUDE_BIT.Low ? step >> DELTA_SHIFT.Low : 0) +
      (code & MAGNITUDE_BIT.Middle ? step >> DELTA_SHIFT.Middle : 0) +
      (code & MAGNITUDE_BIT.High ? step : 0);
    sample = Math.max(
      -SAMPLE_SCALE,
      Math.min(SAMPLE_SCALE - 1, sample + (code & DIRECTION_BIT ? -delta : delta)),
    );
    index = Math.max(
      0,
      Math.min(MAX_INDEX, index + (tables.indexDeltas[code & MAGNITUDE_MASK] ?? 0)),
    );
    output[at + frame * channels] = sample / SAMPLE_SCALE;
  }
  state.index = index;
  state.sample = sample;
  return true;
}
export class IMA4Decoder {
  private state: ChannelState[];
  constructor(readonly channels: number) {
    if (!Number.isInteger(channels) || channels <= 0 || channels > MAX_CHANNELS)
      throw new Error("Invalid IMA4 channel count.");
    this.state = Array.from({ length: channels }, () => ({ index: 0, sample: 0 }));
  }
  decode(bytes: Uint8Array): Float32Array | null {
    const channels = this.channels;
    const length = (bytes.length / IMA4_PACKET_BYTES) * IMA4_PACKET_FRAMES;
    if (
      bytes.length % (IMA4_PACKET_BYTES * channels) ||
      length * Float32Array.BYTES_PER_ELEMENT > MAX_DECODED_BYTES
    )
      return null;
    const samples = new Float32Array(length),
      state = this.state.map((s) => ({ ...s }));
    const groups = bytes.length / (IMA4_PACKET_BYTES * channels);
    for (let group = 0; group < groups; group++)
      for (const [channel, saved] of state.entries()) {
        const start = (group * channels + channel) * IMA4_PACKET_BYTES;
        if (
          !packet(
            bytes,
            start,
            samples,
            group * IMA4_PACKET_FRAMES * channels + channel,
            channels,
            saved,
          )
        )
          return null;
      }
    this.state = state;
    return samples;
  }
}
export function decodeIMA4(bytes: Uint8Array, channels: number): Float32Array | null {
  if (!Number.isInteger(channels) || channels <= 0 || channels > MAX_CHANNELS) return null;
  return new IMA4Decoder(channels).decode(bytes);
}
