import { crc32 } from "../../formats/crc32";
const Limits = { Entries: 65_535, Bytes: 0xffffffff, NameBytes: 65_535 } as const;
const Signature = { Local: 0x04034b50, Central: 0x02014b50, End: 0x06054b50 } as const;
const Length = { Local: 30, Central: 46, End: 22 } as const;
const VERSION = 20;
const UTF8_NAMES = 0x0800;
const DOS_EPOCH_DATE = 0x0021;
const Local = {
  Version: 4,
  Flags: 6,
  Date: 12,
  CRC: 14,
  Compressed: 18,
  Size: 22,
  Name: 26,
} as const;
const Central = {
  Creator: 4,
  Version: 6,
  Flags: 8,
  Date: 14,
  CRC: 16,
  Compressed: 20,
  Size: 24,
  Name: 28,
  Offset: 42,
} as const;
const End = { DiskCount: 8, TotalCount: 10, Size: 12, Offset: 16 } as const;
export interface ZipMember {
  readonly path: string;
  readonly contents: Blob;
}
interface Entry {
  readonly name: Uint8Array<ArrayBuffer>;
  readonly size: number;
  readonly crc: number;
  readonly offset: number;
}
function nameBytes(path: string): Uint8Array<ArrayBuffer> {
  const segments = path.replace(/\/$/, "").split("/");
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid backup archive path.");
  const bytes = new TextEncoder().encode(path);
  if (bytes.length > Limits.NameBytes) throw new Error("Backup filename is too long.");
  return bytes;
}
async function checksum(blob: Blob, signal?: AbortSignal): Promise<number> {
  let crc = 0;
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return crc;
      crc = crc32(crc, value);
    }
  } catch (error) {
    await reader.cancel(error);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
function localHeader(entry: Entry): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Length.Local),
    view = new DataView(bytes.buffer);
  view.setUint32(0, Signature.Local, true);
  view.setUint16(Local.Version, VERSION, true);
  view.setUint16(Local.Flags, UTF8_NAMES, true);
  view.setUint16(Local.Date, DOS_EPOCH_DATE, true);
  view.setUint32(Local.CRC, entry.crc, true);
  view.setUint32(Local.Compressed, entry.size, true);
  view.setUint32(Local.Size, entry.size, true);
  view.setUint16(Local.Name, entry.name.length, true);
  return bytes;
}
function centralHeader(entry: Entry): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Length.Central),
    view = new DataView(bytes.buffer);
  view.setUint32(0, Signature.Central, true);
  view.setUint16(Central.Creator, VERSION, true);
  view.setUint16(Central.Version, VERSION, true);
  view.setUint16(Central.Flags, UTF8_NAMES, true);
  view.setUint16(Central.Date, DOS_EPOCH_DATE, true);
  view.setUint32(Central.CRC, entry.crc, true);
  view.setUint32(Central.Compressed, entry.size, true);
  view.setUint32(Central.Size, entry.size, true);
  view.setUint16(Central.Name, entry.name.length, true);
  view.setUint32(Central.Offset, entry.offset, true);
  return bytes;
}
function endRecord(count: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Length.End),
    view = new DataView(bytes.buffer);
  view.setUint32(0, Signature.End, true);
  view.setUint16(End.DiskCount, count, true);
  view.setUint16(End.TotalCount, count, true);
  view.setUint32(End.Size, size, true);
  view.setUint32(End.Offset, offset, true);
  return bytes;
}
export async function writeZip(members: readonly ZipMember[], signal?: AbortSignal): Promise<Blob> {
  if (members.length >= Limits.Entries) throw new Error("Too many files for this backup format.");
  const local: BlobPart[] = [],
    central: BlobPart[] = [],
    paths = new Set<string>();
  let offset = 0,
    centralSize = 0;
  for (const member of members) {
    signal?.throwIfAborted();
    const name = nameBytes(member.path),
      size = member.contents.size;
    if (paths.has(member.path)) throw new Error("Duplicate backup archive path.");
    paths.add(member.path);
    const nextOffset = offset + Length.Local + name.length + size;
    centralSize += Length.Central + name.length;
    if (size >= Limits.Bytes || nextOffset + centralSize + Length.End >= Limits.Bytes)
      throw new Error("This backup exceeds the ZIP format's 4 GiB limit.");
    const entry = { name, size, crc: await checksum(member.contents, signal), offset };
    local.push(localHeader(entry), name, member.contents);
    central.push(centralHeader(entry), name);
    offset = nextOffset;
  }
  signal?.throwIfAborted();
  return new Blob([...local, ...central, endRecord(members.length, centralSize, offset)], {
    type: "application/zip",
  });
}
