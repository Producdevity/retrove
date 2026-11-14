import { ALError, MAX_BUFFER_BYTES, OpenALError, PCMFormat } from "./constants";
const STEREO_CHANNELS = 2;
const BYTE_MIDPOINT = 128;
const SHORT_SCALE = 32768;
const BITS_PER_BYTE = 8;
export interface PCM {
  readonly channels: readonly Float32Array[];
  readonly frames: number;
  readonly rate: number;
  readonly sampleBytes: number;
  readonly duration: number;
}
export function decodePCM(format: number, bytes: Uint8Array, rate: number): PCM {
  const channels =
    format === PCMFormat.Stereo8 || format === PCMFormat.Stereo16 ? STEREO_CHANNELS : 1;
  const sampleBytes =
    format === PCMFormat.Mono16 || format === PCMFormat.Stereo16 ? Int16Array.BYTES_PER_ELEMENT : 1;
  if (!Object.values(PCMFormat).some((value) => value === format))
    throw new OpenALError(ALError.InvalidEnum);
  if (!Number.isInteger(rate) || rate <= 0 || bytes.length % (channels * sampleBytes))
    throw new OpenALError(ALError.InvalidValue);
  if (bytes.length > MAX_BUFFER_BYTES) throw new OpenALError(ALError.OutOfMemory);
  const frames = bytes.length / (channels * sampleBytes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoded = Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: frames }, (_, frame) => {
      const offset = (frame * channels + channel) * sampleBytes;
      return sampleBytes === 1
        ? (view.getUint8(offset) - BYTE_MIDPOINT) / BYTE_MIDPOINT
        : view.getInt16(offset, true) / SHORT_SCALE;
    }),
  );
  return { channels: decoded, frames, rate, sampleBytes, duration: frames / rate };
}
export function pcmBits(pcm: PCM): number {
  return pcm.sampleBytes * BITS_PER_BYTE;
}
export function pcmBytes(pcm: PCM): number {
  return pcm.frames * pcm.channels.length * pcm.sampleBytes;
}
