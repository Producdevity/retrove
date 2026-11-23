import { compressedFileType, decodedAudioFile, MAX_COMPRESSED_BYTES } from "./decoded";
import type { AudioDecode } from "./decoded";
import { AudioFileError, AudioFileStatus } from "./types";
import type { AudioFileRecord } from "./types";
import { bytesView, cafFormat, fourText, UNSUPPORTED_TYPE, waveFormat } from "./audio-file-format";
import type { StreamFormat } from "./audio-file-format";
import { fileProperties, packetLayout, packetTable } from "./audio-file-packets";
import type { PacketTable, ReadBytes } from "./audio-file-packets";

const DECODE_RATE = 44100;
const HEADER_BYTES = 12;
const CAF_CHUNK = 12;
const WAVE_CHUNK = 8;
const CAF_HEADER = 8;
const CAF_DESC_BYTES = 32;
const WAVE_FMT_BYTES = 16;
const PAKT_HEADER = 24;
const PAKT_MAX = 0x4000000;
const PAKT_PACKETS_MAX = 0x1000000;
const COOKIE_MAX = 0x100000;
const NO_PACKETS = BigInt(0);
const CAF_DATA_SKIP = 4;
const SIZE_AT = 4;
const WAVE_TYPE_AT = 8;
const PAKT_VALID_AT = 8;
const WAVE_ALIGNMENT = 2;

interface ScanState {
  format: StreamFormat | undefined;
  dataAt: number | undefined;
  dataSize: number;
  cookie: Uint8Array | undefined;
  table: PacketTable | undefined;
}
interface Chunk {
  caf: boolean;
  name: string;
  at: number;
  size: number;
}

function fail(code: number): never {
  throw new AudioFileError(code);
}
const browserDecode: AudioDecode = (bytes) =>
  new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(Uint8Array.from(bytes).buffer);

async function scanChunk(state: ScanState, chunk: Chunk, read: ReadBytes): Promise<void> {
  const { caf, name, at, size } = chunk;
  if (name === "data") {
    const skip = caf ? CAF_DATA_SKIP : 0;
    if (size < skip) fail(AudioFileStatus.Invalid);
    state.dataAt = at + skip;
    state.dataSize = size - skip;
  } else if (caf && name === "desc") {
    if (size < CAF_DESC_BYTES) fail(AudioFileStatus.Invalid);
    state.format = cafFormat(bytesView(await read(at, CAF_DESC_BYTES)));
  } else if (!caf && name === "fmt ") {
    if (size < WAVE_FMT_BYTES) fail(AudioFileStatus.Invalid);
    state.format = waveFormat(bytesView(await read(at, WAVE_FMT_BYTES)));
  } else if (caf && name === "kuki") {
    if (size > COOKIE_MAX) fail(AudioFileStatus.Invalid);
    state.cookie = await read(at, size);
  } else if (caf && name === "pakt") {
    if (size < PAKT_HEADER || size > PAKT_MAX) fail(AudioFileStatus.Invalid);
    const header = bytesView(await read(at, PAKT_HEADER)),
      count = Number(header.getBigInt64(0)),
      valid = header.getBigInt64(PAKT_VALID_AT);
    if (count < 0 || count > PAKT_PACKETS_MAX || valid < NO_PACKETS) fail(AudioFileStatus.Invalid);
    state.table = packetTable(header, at + PAKT_HEADER, size - PAKT_HEADER, count, valid);
  }
}

async function scanChunks(read: ReadBytes, size: number, caf: boolean): Promise<ScanState> {
  const state: ScanState = {
    format: undefined,
    dataAt: undefined,
    dataSize: 0,
    cookie: undefined,
    table: undefined,
  };
  const headerBytes = caf ? CAF_CHUNK : WAVE_CHUNK;
  let at = caf ? CAF_HEADER : HEADER_BYTES;
  while (at + headerBytes <= size) {
    const header = await read(at, headerBytes),
      view = bytesView(header),
      name = fourText(header, 0);
    at += header.length;
    let length = caf ? Number(view.getBigInt64(SIZE_AT)) : view.getUint32(SIZE_AT, true);
    if (caf && name === "data" && length === -1) length = size - at;
    if (!Number.isSafeInteger(length) || length < 0 || length > size - at)
      fail(AudioFileStatus.Invalid);
    await scanChunk(state, { caf, name, at, size: length }, read);
    at += length + (!caf && length % WAVE_ALIGNMENT === 1 ? 1 : 0);
  }
  return state;
}

async function inspectLinear(
  read: ReadBytes,
  size: number,
  caf: boolean,
): Promise<AudioFileRecord> {
  const { format, dataAt, dataSize, cookie, table } = await scanChunks(read, size, caf);
  if (
    !format ||
    dataAt === undefined ||
    !Number.isFinite(format.rate) ||
    format.rate <= 0 ||
    !format.channels
  )
    fail(AudioFileStatus.Invalid);
  const layout = await packetLayout(read, format, table, dataSize),
    props = fileProperties(caf ? "caff" : "WAVE", format, dataSize, dataAt, layout, table, cookie);
  return {
    props,
    dataAt,
    dataSize,
    count: layout.count,
    packetBytes: format.packetBytes,
    ...(layout.offsets ? { offsets: layout.offsets } : {}),
    ...(layout.frames ? { frames: layout.frames } : {}),
    read,
  };
}

export async function inspectAudioFile(
  read: ReadBytes,
  size: number,
  decode: AudioDecode = browserDecode,
): Promise<AudioFileRecord> {
  if (size < HEADER_BYTES) fail(UNSUPPORTED_TYPE);
  const head = await read(0, HEADER_BYTES),
    kind = fourText(head, 0);
  const caf = kind === "caff",
    wave = kind === "RIFF" && fourText(head, WAVE_TYPE_AT) === "WAVE";
  if (caf || wave) return inspectLinear(read, size, caf);
  const type = compressedFileType(head);
  if (type === undefined || size > MAX_COMPRESSED_BYTES) fail(UNSUPPORTED_TYPE);
  return decodedAudioFile(await read(0, size), type, decode);
}
