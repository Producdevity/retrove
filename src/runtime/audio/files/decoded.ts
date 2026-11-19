import { AudioFileError, AudioFileStatus, type AudioFileRecord } from "./types";

/** The parts of a Web Audio AudioBuffer a decoded file needs. */
export interface DecodedAudio {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}
export type AudioDecode = (bytes: Uint8Array) => Promise<DecodedAudio>;

const SAMPLE_BYTES = 2;
const SAMPLE_MAX = 0x7fff;
const BITS_PER_BYTE = 8;
const ASBD_BYTES = 40;
const ASBD_FIELDS_AT = 8;
const WORD_BYTES = 4;
const SCALAR_BYTES = 4;
const WIDE_BYTES = 8;
/** Larger files would hold too much decoded PCM in memory. */
export const MAX_COMPRESSED_BYTES = 33_554_432;
/** kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, little-endian. */
const SIGNED_PACKED = 12;
const MPEG_SYNC = 0xff;
const MPEG_SYNC_MASK = 0xe0;
const ID3_TAG = "ID3";
const MP4_BRAND_AT = 4;
const MP4_BRAND = "ftyp";

const CODE_UNIT_RANGE = 256;
const NO_OFFSET = BigInt(0);
function fourcc(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index++)
    code = code * CODE_UNIT_RANGE + value.charCodeAt(index);
  return code;
}
function word(head: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...head.subarray(at, at + length));
}
/** The AudioFile type of an MPEG-4 or MPEG audio stream the browser can decode, if `head` starts one. */
export function compressedFileType(head: Uint8Array): number | undefined {
  if (word(head, MP4_BRAND_AT, MP4_BRAND.length) === MP4_BRAND) return fourcc("m4af");
  if (word(head, 0, ID3_TAG.length) === ID3_TAG) return fourcc("MPG3");
  const [first = 0, second = 0] = head;
  if (first === MPEG_SYNC && (second & MPEG_SYNC_MASK) === MPEG_SYNC_MASK) return fourcc("MPG3");
  return undefined;
}

function scalar(bytes: number, write: (view: DataView) => void): Uint8Array {
  const value = new Uint8Array(bytes);
  write(new DataView(value.buffer));
  return value;
}
function linearDescription(rate: number, channels: number): Uint8Array {
  const frameBytes = channels * SAMPLE_BYTES;
  return scalar(ASBD_BYTES, (view) => {
    view.setFloat64(0, rate, true);
    [
      fourcc("lpcm"),
      SIGNED_PACKED,
      frameBytes,
      1,
      frameBytes,
      channels,
      SAMPLE_BYTES * BITS_PER_BYTE,
    ]
      .map((value, index) => [ASBD_FIELDS_AT + index * WORD_BYTES, value] as const)
      .forEach(([at, value]) => view.setUint32(at, value, true));
  });
}
function interleave(audio: DecodedAudio): Uint8Array {
  const channels = audio.numberOfChannels,
    pcm = new Uint8Array(audio.length * channels * SAMPLE_BYTES),
    view = new DataView(pcm.buffer);
  for (let channel = 0; channel < channels; channel++) {
    const samples = audio.getChannelData(channel);
    for (let frame = 0; frame < audio.length; frame++) {
      const value = Math.max(-1, Math.min(1, samples[frame] ?? 0));
      view.setInt16(
        (frame * channels + channel) * SAMPLE_BYTES,
        Math.round(value * SAMPLE_MAX),
        true,
      );
    }
  }
  return pcm;
}

/**
 * A compressed file presented as the 16-bit linear PCM it decodes to, so queues and readers
 * that honour the file's data format play it with the codecs the browser already has.
 */
export async function decodedAudioFile(
  bytes: Uint8Array,
  type: number,
  decode: AudioDecode,
): Promise<AudioFileRecord> {
  let audio: DecodedAudio;
  try {
    audio = await decode(bytes);
  } catch {
    throw new AudioFileError(AudioFileStatus.Invalid);
  }
  if (!audio.numberOfChannels || !(audio.sampleRate > 0))
    throw new AudioFileError(AudioFileStatus.Invalid);
  const pcm = interleave(audio),
    frameBytes = audio.numberOfChannels * SAMPLE_BYTES,
    duration = audio.length / audio.sampleRate;
  const props = new Map<number, Uint8Array>([
    [fourcc("ffmt"), scalar(SCALAR_BYTES, (view) => view.setUint32(0, type, true))],
    [fourcc("dfmt"), linearDescription(audio.sampleRate, audio.numberOfChannels)],
    [fourcc("bcnt"), scalar(WIDE_BYTES, (view) => view.setBigUint64(0, BigInt(pcm.length), true))],
    [
      fourcc("pcnt"),
      scalar(WIDE_BYTES, (view) => view.setBigUint64(0, BigInt(audio.length), true)),
    ],
    [fourcc("psze"), scalar(SCALAR_BYTES, (view) => view.setUint32(0, frameBytes, true))],
    [fourcc("pkub"), scalar(SCALAR_BYTES, (view) => view.setUint32(0, frameBytes, true))],
    [fourcc("doff"), scalar(WIDE_BYTES, (view) => view.setBigUint64(0, NO_OFFSET, true))],
    [fourcc("edur"), scalar(WIDE_BYTES, (view) => view.setFloat64(0, duration, true))],
    [
      fourcc("brat"),
      scalar(SCALAR_BYTES, (view) =>
        view.setUint32(0, Math.round(audio.sampleRate * frameBytes * BITS_PER_BYTE), true),
      ),
    ],
  ]);
  return {
    props,
    dataAt: 0,
    dataSize: pcm.length,
    count: audio.length,
    packetBytes: frameBytes,
    read: (offset, length) => Promise.resolve(pcm.slice(offset, offset + length)),
  };
}
