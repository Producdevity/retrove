import { AudioFileError } from "./types";

const CODE_RANGE = 256;
const ASBD_BYTES = 40;
const ASBD_FIELDS_AT = 8;
const FIELD_BYTES = 4;
const Caf = {
  Rate: 0,
  Format: 8,
  Flags: 12,
  PacketBytes: 16,
  PacketFrames: 20,
  Channels: 24,
  Bits: 28,
} as const;
const Wave = { Channels: 2, Rate: 4, FrameBytes: 12, Bits: 14 } as const;
const CafFlag = { Float: 1, BigEndian: 2 } as const;
const AsbdFlag = { Float: 1, BigEndian: 2, Signed: 4, Packed: 8 } as const;
const WAVE_PCM = 1;
const WAVE_FLOAT = 3;
const BITS_PER_BYTE = 8;

export function tag(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index++)
    code = code * CODE_RANGE + value.charCodeAt(index);
  return code;
}
export const UNSUPPORTED_TYPE = tag("typ?");
export const LINEAR_PCM = tag("lpcm");

export interface StreamFormat {
  format: number;
  rate: number;
  flags: number;
  packetBytes: number;
  packetFrames: number;
  frameBytes: number;
  channels: number;
  bits: number;
}

export function bytesView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
export function fourText(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + FIELD_BYTES));
}
export function streamDescription(format: StreamFormat): Uint8Array {
  const bytes = new Uint8Array(ASBD_BYTES),
    view = bytesView(bytes);
  view.setFloat64(0, format.rate, true);
  [
    format.format,
    format.flags,
    format.packetBytes,
    format.packetFrames,
    format.frameBytes,
    format.channels,
    format.bits,
  ].forEach((value, index) => view.setUint32(ASBD_FIELDS_AT + index * FIELD_BYTES, value, true));
  return bytes;
}
export function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(FIELD_BYTES);
  bytesView(bytes).setUint32(0, value, true);
  return bytes;
}
export function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(BigUint64Array.BYTES_PER_ELEMENT);
  bytesView(bytes).setBigUint64(0, value, true);
  return bytes;
}
export function f64(value: number): Uint8Array {
  const bytes = new Uint8Array(Float64Array.BYTES_PER_ELEMENT);
  bytesView(bytes).setFloat64(0, value, true);
  return bytes;
}

export function cafFormat(view: DataView): StreamFormat {
  const format = view.getUint32(Caf.Format),
    cafFlags = view.getUint32(Caf.Flags),
    packetBytes = view.getUint32(Caf.PacketBytes),
    packetFrames = view.getUint32(Caf.PacketFrames);
  const linear = format === LINEAR_PCM;
  const flags = linear
    ? (cafFlags & CafFlag.Float ? AsbdFlag.Float : AsbdFlag.Signed) |
      (cafFlags & CafFlag.BigEndian ? 0 : AsbdFlag.BigEndian) |
      AsbdFlag.Packed
    : cafFlags;
  return {
    format,
    rate: view.getFloat64(Caf.Rate),
    flags,
    packetBytes,
    packetFrames,
    frameBytes: linear && packetFrames ? packetBytes / packetFrames : 0,
    channels: view.getUint32(Caf.Channels),
    bits: view.getUint32(Caf.Bits),
  };
}

export function waveFormat(view: DataView): StreamFormat {
  const code = view.getUint16(0, true),
    bits = view.getUint16(Wave.Bits, true);
  if (code !== WAVE_PCM && code !== WAVE_FLOAT) throw new AudioFileError(UNSUPPORTED_TYPE);
  const frameBytes = view.getUint16(Wave.FrameBytes, true);
  return {
    format: LINEAR_PCM,
    rate: view.getUint32(Wave.Rate, true),
    flags:
      AsbdFlag.Packed |
      (code === WAVE_FLOAT ? AsbdFlag.Float : bits === BITS_PER_BYTE ? 0 : AsbdFlag.Signed),
    packetBytes: frameBytes,
    packetFrames: 1,
    frameBytes,
    channels: view.getUint16(Wave.Channels, true),
    bits,
  };
}
