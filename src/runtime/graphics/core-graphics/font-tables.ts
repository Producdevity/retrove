/** TrueType/OpenType table parsing needed to turn CGGlyph IDs back into characters. */
const Directory = { TableCount: 4, Records: 12, RecordBytes: 16, Offset: 8 } as const;
const Cmap = { Count: 2, Records: 4, RecordBytes: 8, Encoding: 2, Offset: 4 } as const;
const CMAP_TAG = "cmap";
const TAG_BYTES = 4;
const Format = {
  ByteEncoding: 0,
  SegmentMapping: 4,
  TrimmedTable: 6,
  SegmentedCoverage: 12,
} as const;
const Format4 = { SegCountX2: 6, EndCodes: 14, PadBytes: 2 } as const;
const Format6 = { FirstCode: 6, Count: 8, Glyphs: 10 } as const;
const Format12 = { Groups: 12, First: 16, GroupBytes: 12, End: 4, Glyph: 8 } as const;
const BYTE_ENCODING_GLYPHS = 6;
const BYTE_ENCODING_SIZE = 256;
const MISSING_SEGMENT = 0xffff;
const GLYPH_MASK = 0xffff;
const U16 = 2;
const Platform = { Unicode: 0, Macintosh: 1, Windows: 3 } as const;
const Encoding = {
  Unicode10: 0,
  Unicode11: 1,
  Unicode2Bmp: 3,
  Unicode2Full: 4,
  MacRoman: 0,
  WindowsBmp: 1,
  WindowsFull: 10,
} as const;
/** Encodings in preference order: full Unicode, BMP Unicode, then Mac Roman. */
const PREFERRED: readonly (readonly [number, number])[] = [
  [Platform.Windows, Encoding.WindowsFull],
  [Platform.Windows, Encoding.WindowsBmp],
  [Platform.Unicode, Encoding.Unicode2Bmp],
  [Platform.Unicode, Encoding.Unicode2Full],
  [Platform.Unicode, Encoding.Unicode11],
  [Platform.Unicode, Encoding.Unicode10],
  [Platform.Macintosh, Encoding.MacRoman],
];

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function table(data: DataView, tag: string): number | undefined {
  const count = data.getUint16(Directory.TableCount);
  for (let index = 0; index < count; index++) {
    const at = Directory.Records + index * Directory.RecordBytes;
    const name = String.fromCharCode(
      ...Array.from({ length: TAG_BYTES }, (_, i) => data.getUint8(at + i)),
    );
    if (name === tag) return data.getUint32(at + Directory.Offset);
  }
  return undefined;
}
function add(map: Map<number, number>, glyph: number, code: number): void {
  if (glyph && !map.has(glyph)) map.set(glyph, code);
}
function segmentMapping(data: DataView, at: number, map: Map<number, number>): void {
  const segments = data.getUint16(at + Format4.SegCountX2) / U16;
  const ends = at + Format4.EndCodes,
    starts = ends + segments * U16 + Format4.PadBytes,
    deltas = starts + segments * U16,
    ranges = deltas + segments * U16;
  for (let segment = 0; segment < segments; segment++) {
    const end = data.getUint16(ends + segment * U16),
      start = data.getUint16(starts + segment * U16),
      delta = data.getUint16(deltas + segment * U16),
      rangeAt = ranges + segment * U16,
      range = data.getUint16(rangeAt);
    if (start === MISSING_SEGMENT) continue;
    for (let code = start; code <= end; code++) {
      if (!range) {
        add(map, (code + delta) & GLYPH_MASK, code);
        continue;
      }
      const glyphAt = rangeAt + range + (code - start) * U16;
      if (glyphAt + U16 > data.byteLength) break;
      const glyph = data.getUint16(glyphAt);
      if (glyph) add(map, (glyph + delta) & GLYPH_MASK, code);
    }
  }
}
function subtable(data: DataView, at: number, map: Map<number, number>): void {
  switch (data.getUint16(at)) {
    case Format.ByteEncoding:
      for (let code = 0; code < BYTE_ENCODING_SIZE; code++)
        add(map, data.getUint8(at + BYTE_ENCODING_GLYPHS + code), code);
      break;
    case Format.SegmentMapping:
      segmentMapping(data, at, map);
      break;
    case Format.TrimmedTable: {
      const first = data.getUint16(at + Format6.FirstCode),
        count = data.getUint16(at + Format6.Count);
      for (let index = 0; index < count; index++)
        add(map, data.getUint16(at + Format6.Glyphs + index * U16), first + index);
      break;
    }
    case Format.SegmentedCoverage: {
      const groups = data.getUint32(at + Format12.Groups);
      for (let index = 0; index < groups; index++) {
        const group = at + Format12.First + index * Format12.GroupBytes;
        const start = data.getUint32(group),
          end = data.getUint32(group + Format12.End),
          glyph = data.getUint32(group + Format12.Glyph);
        for (let code = start; code <= end; code++) add(map, glyph + code - start, code);
      }
      break;
    }
  }
}

/** Maps each glyph ID to the lowest character code that selects it, or throws on a bad font. */
export function glyphCharacters(bytes: Uint8Array): Map<number, number> {
  const data = view(bytes),
    cmap = table(data, CMAP_TAG),
    map = new Map<number, number>();
  if (cmap === undefined) throw new Error("Font has no cmap table.");
  const count = data.getUint16(cmap + Cmap.Count);
  const records = Array.from({ length: count }, (_, index) => {
    const at = cmap + Cmap.Records + index * Cmap.RecordBytes;
    return {
      platform: data.getUint16(at),
      encoding: data.getUint16(at + Cmap.Encoding),
      offset: cmap + data.getUint32(at + Cmap.Offset),
    };
  });
  for (const [platform, encoding] of PREFERRED)
    for (const record of records)
      if (record.platform === platform && record.encoding === encoding)
        subtable(data, record.offset, map);
  return map;
}
