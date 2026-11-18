/** A ZIP member found by walking local file headers. */
export interface RecoveredEntry {
  readonly rawPath: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}
export interface Recovery {
  readonly entries: RecoveredEntry[];
  /** Where the recovered members end; payloads must lie before it. */
  readonly end: number;
}
type ReadRange = (start: number, length: number) => Promise<Uint8Array>;

const LOCAL_SIGNATURE = 0x04034b50;
const Local = {
  Header: 30,
  Flags: 6,
  Method: 8,
  Time: 10,
  Date: 12,
  Crc: 14,
  CompressedSize: 18,
  Size: 22,
  NameLength: 26,
  ExtraLength: 28,
} as const;
/** General purpose flag bit 3: sizes follow the data instead of the header. */
const DATA_DESCRIPTOR = 8;
const SATURATED = 0xffffffff;
const ZIP64_EXTRA = 1;
const Extra = { Header: 4, Size: 2, Uncompressed: 0, Compressed: 8 } as const;
/** The local ZIP64 extra holds the uncompressed then compressed size, 8 bytes each. */
const ZIP64_SIZES_BYTES = 16;

function zip64Sizes(extra: Uint8Array): { size: number; compressedSize: number } | undefined {
  const data = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + Extra.Header <= extra.length;) {
    const id = data.getUint16(at, true),
      length = data.getUint16(at + Extra.Size, true);
    at += Extra.Header;
    if (id === ZIP64_EXTRA && length >= ZIP64_SIZES_BYTES && at + length <= extra.length) {
      const size = Number(data.getBigUint64(at + Extra.Uncompressed, true));
      const compressedSize = Number(data.getBigUint64(at + Extra.Compressed, true));
      return Number.isSafeInteger(size) && Number.isSafeInteger(compressedSize)
        ? { size, compressedSize }
        : undefined;
    }
    at += length;
  }
  return undefined;
}

/**
 * Rebuilds a ZIP index from its local file headers, for archives whose end record or central
 * directory was cut off. Stops at the first member whose data is missing or whose sizes are
 * only known from a trailing data descriptor.
 */
export async function recoverLocalEntries(read: ReadRange, archiveSize: number): Promise<Recovery> {
  const entries: RecoveredEntry[] = [];
  let offset = 0;
  while (offset + Local.Header <= archiveSize) {
    const header = await read(offset, Local.Header);
    const data = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (data.getUint32(0, true) !== LOCAL_SIGNATURE) break;
    const flags = data.getUint16(Local.Flags, true);
    const nameLength = data.getUint16(Local.NameLength, true),
      extraLength = data.getUint16(Local.ExtraLength, true);
    const start = offset + Local.Header + nameLength + extraLength;
    if (start > archiveSize || flags & DATA_DESCRIPTOR) break;
    const names = await read(offset + Local.Header, nameLength + extraLength);
    let size = data.getUint32(Local.Size, true),
      compressedSize = data.getUint32(Local.CompressedSize, true);
    if (size === SATURATED || compressedSize === SATURATED) {
      const wide = zip64Sizes(names.subarray(nameLength));
      if (!wide) break;
      ({ size, compressedSize } = wide);
    }
    if (compressedSize > archiveSize - start) break;
    entries.push({
      rawPath: names.slice(0, nameLength),
      flags,
      method: data.getUint16(Local.Method, true),
      time: data.getUint16(Local.Time, true),
      date: data.getUint16(Local.Date, true),
      crc: data.getUint32(Local.Crc, true),
      compressedSize,
      size,
      offset,
    });
    offset = start + compressedSize;
  }
  return { entries, end: offset };
}
