import { crc32 } from "./crc32";
import { ZStream, inflateInit2, inflate, inflateEnd } from "../../../web/vendor/pako-zlib.mjs";

const IHDR = 0x4948_4452;
const IDAT = 0x4944_4154;
const IEND = 0x4945_4e44;
const CGBI = 0x4367_4249;
const PNG_SIGNATURE_HIGH = 0x8950_4e47;
const PNG_SIGNATURE_LOW = 0x0d0a_1a0a;
const SIGNATURE_BYTES = 8;
const CGBI_TYPE_OFFSET = 12;
const MIN_BYTES = 20;
const CHUNK_OVERHEAD = 12;
const CHUNK_HEADER = 8;
const CRC_BYTES = 4;
const HEADER_BYTES = 13;
const MAX_PIXELS = 0x200_0000;
const COLOR_RGB = 2;
const COLOR_RGBA = 6;
const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const BIT_DEPTH = 8;
const MAX_INTERLACE = 1;
const OPAQUE = 255;
const NO_FLUSH = 0;
const Z_STREAM_END = 1;
const RAW_WINDOW_BITS = -15;
const FilterType = { Sub: 1, Up: 2, Average: 3, Paeth: 4 } as const;
const Ihdr = {
  Height: 4,
  BitDepth: 8,
  ColorType: 9,
  Compression: 10,
  Filter: 11,
  Interlace: 12,
} as const;
const Pixel = { Red: 0, Green: 1, Blue: 2, Alpha: 3 } as const;
const Step = { Half: 2, Quarter: 4, Eighth: 8 } as const;
const adam7: readonly (readonly [number, number, number, number])[] = [
  [0, 0, Step.Eighth, Step.Eighth],
  [Step.Quarter, 0, Step.Eighth, Step.Eighth],
  [0, Step.Quarter, Step.Quarter, Step.Eighth],
  [Step.Half, 0, Step.Quarter, Step.Quarter],
  [0, Step.Half, Step.Half, Step.Quarter],
  [1, 0, Step.Half, Step.Half],
  [0, 1, 1, Step.Half],
];

interface Pass {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly w: number;
  readonly h: number;
}
interface Header {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly interlaced: boolean;
  readonly parts: readonly Uint8Array[];
}
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c,
    x = Math.abs(p - a),
    y = Math.abs(p - b),
    z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
}

function parseChunks(bytes: Uint8Array, view: DataView): Header {
  const byteAt = (index: number): number => bytes[index] ?? 0;
  let width = 0,
    height = 0,
    channels = 0,
    interlaced = false,
    end = false;
  const parts: Uint8Array[] = [];
  for (let i = SIGNATURE_BYTES; i < bytes.length;) {
    if (i + CHUNK_OVERHEAD > bytes.length) throw new Error("Truncated CgBI chunk header");
    const n = view.getUint32(i),
      type = view.getUint32(i + CRC_BYTES),
      pos = i + CHUNK_HEADER;
    if (n > bytes.length - pos - CRC_BYTES) throw new Error("Truncated CgBI image chunk");
    if (crc32(0, bytes.subarray(i + CRC_BYTES, pos + n)) !== view.getUint32(pos + n))
      throw new Error("CgBI image CRC mismatch");
    if (type === IHDR) {
      if (n !== HEADER_BYTES) throw new Error("Invalid CgBI image header");
      width = view.getUint32(pos);
      height = view.getUint32(pos + Ihdr.Height);
      const colorType = byteAt(pos + Ihdr.ColorType);
      channels =
        colorType === COLOR_RGB ? RGB_CHANNELS : colorType === COLOR_RGBA ? RGBA_CHANNELS : 0;
      if (
        !width ||
        !height ||
        width * height > MAX_PIXELS ||
        !channels ||
        byteAt(pos + Ihdr.BitDepth) !== BIT_DEPTH ||
        byteAt(pos + Ihdr.Compression) ||
        byteAt(pos + Ihdr.Filter) ||
        byteAt(pos + Ihdr.Interlace) > MAX_INTERLACE
      )
        throw new Error("Unsupported CgBI bitmap layout");
      interlaced = !!byteAt(pos + Ihdr.Interlace);
    } else if (type === IDAT) parts.push(bytes.subarray(pos, pos + n));
    else if (type === IEND) {
      end = true;
      break;
    }
    i = pos + n + CRC_BYTES;
  }
  if (!end || !channels || !parts.length) throw new Error("Incomplete CgBI image");
  return { width, height, channels, interlaced, parts };
}

function layoutPasses({ width, height, interlaced }: Header): Pass[] {
  return (interlaced ? adam7 : [[0, 0, 1, 1] as const])
    .map(([x, y, dx, dy]) => ({
      x,
      y,
      dx,
      dy,
      w: Math.max(0, Math.ceil((width - x) / dx)),
      h: Math.max(0, Math.ceil((height - y) / dy)),
    }))
    .filter((pass) => pass.w && pass.h);
}

function inflateScanlines(parts: readonly Uint8Array[], size: number): Uint8Array {
  const scanlines = new Uint8Array(size),
    stream = new ZStream();
  if (inflateInit2(stream, RAW_WINDOW_BITS) !== 0)
    throw new Error("Could not initialize CgBI decompression");
  stream.output = scanlines;
  stream.avail_out = size;
  let status: number | undefined;
  try {
    for (const input of parts) {
      stream.input = input;
      stream.next_in = 0;
      stream.avail_in = input.length;
      status = inflate(stream, NO_FLUSH);
      if (status === Z_STREAM_END) break;
      if (status !== 0) throw new Error("Invalid compressed CgBI image");
    }
    if (status !== Z_STREAM_END || stream.total_out !== size)
      throw new Error("CgBI scanline length mismatch");
  } finally {
    inflateEnd(stream);
  }
  return scanlines;
}

function unfilter(
  row: Uint8Array,
  prev: Uint8Array | null,
  filter: number,
  channels: number,
): void {
  for (let i = 0; i < row.length; i++) {
    const left = i < channels ? 0 : (row[i - channels] ?? 0),
      up = prev?.[i] ?? 0,
      corner = i < channels ? 0 : (prev?.[i - channels] ?? 0);
    row[i] =
      (row[i] ?? 0) +
      (filter === FilterType.Sub
        ? left
        : filter === FilterType.Up
          ? up
          : filter === FilterType.Average
            ? (left + up) >>> 1
            : filter === FilterType.Paeth
              ? paeth(left, up, corner)
              : 0);
  }
}

function convert(scanlines: Uint8Array, passes: readonly Pass[], header: Header): DecodedImage {
  const { width, height, channels } = header;
  const rgba = new Uint8ClampedArray(RGBA_CHANNELS * width * height);
  let cursor = 0;
  for (const pass of passes) {
    const rowBytes = pass.w * channels;
    let prev: Uint8Array | null = null;
    for (let y = 0; y < pass.h; y++) {
      const filter = scanlines[cursor++] ?? 0,
        row = scanlines.subarray(cursor, cursor + rowBytes);
      if (filter > FilterType.Paeth) throw new Error("Invalid CgBI row filter");
      cursor += rowBytes;
      unfilter(row, prev, filter, channels);
      for (let x = 0; x < pass.w; x++) {
        const i = x * channels,
          p = RGBA_CHANNELS * ((pass.y + y * pass.dy) * width + pass.x + x * pass.dx);
        const alpha = channels === RGBA_CHANNELS ? (row[i + Pixel.Alpha] ?? 0) : OPAQUE,
          scale = alpha ? OPAQUE / alpha : 0;
        rgba[p + Pixel.Red] = (row[i + Pixel.Blue] ?? 0) * scale;
        rgba[p + Pixel.Green] = (row[i + Pixel.Green] ?? 0) * scale;
        rgba[p + Pixel.Blue] = (row[i + Pixel.Red] ?? 0) * scale;
        rgba[p + Pixel.Alpha] = alpha;
      }
      prev = row;
    }
  }
  return { width, height, rgba };
}

export function decodeCgBI(bytes: Uint8Array): DecodedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < MIN_BYTES ||
    view.getUint32(0) !== PNG_SIGNATURE_HIGH ||
    view.getUint32(CRC_BYTES) !== PNG_SIGNATURE_LOW ||
    view.getUint32(CGBI_TYPE_OFFSET) !== CGBI
  )
    return null;
  const header = parseChunks(bytes, view);
  const passes = layoutPasses(header);
  const size = passes.reduce((n, p) => n + p.h * (1 + p.w * header.channels), 0);
  return convert(inflateScanlines(header.parts, size), passes, header);
}
