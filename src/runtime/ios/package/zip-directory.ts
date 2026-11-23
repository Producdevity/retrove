import { recoverLocalEntries } from "../../formats/zip-recovery";
import type { Diagnostic } from "./zip-types";

export const Signature = {
  Local: 0x04034b50,
  Central: 0x02014b50,
  End: 0x06054b50,
  Zip64: 0x06064b50,
  Locator: 0x07064b50,
} as const;
export interface ZipDirectory {
  start: number;
  size: number;
  count: number;
}
export interface CentralEntry {
  rawPath: Uint8Array;
  modified: number;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EndRecord = {
  Bytes: 22,
  Disk: 4,
  CentralDisk: 6,
  LocalCount: 8,
  Count: 10,
  Size: 12,
  Start: 16,
  CommentLength: 20,
} as const;
const MAX_COMMENT_BYTES = 0xffff;
const Locator = { Bytes: 20, Disk: 4, Offset: 8, Disks: 16 } as const;
const Zip64End = {
  Bytes: 56,
  DiskA: 16,
  DiskB: 20,
  LocalCount: 24,
  Count: 32,
  Size: 40,
  Start: 48,
} as const;
const Central = {
  Bytes: 46,
  Flags: 8,
  Method: 10,
  Time: 12,
  Date: 14,
  Crc: 16,
  CompressedSize: 20,
  Size: 24,
  NameLength: 28,
  ExtraLength: 30,
  CommentLength: 32,
  Disk: 34,
  Offset: 42,
} as const;
const SATURATED_32 = 0xffffffff;
const SATURATED_16 = 0xffff;
const MAX_DIRECTORY_BYTES = 0x4000000;
const Extra = { Header: 4, Size: 2, Zip64Id: 1, FieldBytes: 8 } as const;
const DosDate = { YearShift: 9, MonthShift: 5, Mask: 15, DayMask: 31, BaseYear: 1980 } as const;
const DosTime = {
  HourShift: 11,
  MinuteShift: 5,
  MinuteMask: 63,
  SecondMask: 31,
  SecondScale: 2,
} as const;
const ZIP64_KEYS = ["size", "compressedSize", "offset"] as const;
const RECOVERY_ERROR = /ZIP end record|ZIP directory/;

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function slice(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(start) || start < 0 || length < 0 || length > blob.size - start) {
    throw Error("Truncated ZIP");
  }
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function u64(data: DataView, at: number): number {
  const n = Number(data.getBigUint64(at, true));
  if (!Number.isSafeInteger(n)) throw Error("ZIP64 offset exceeds integer precision");
  return n;
}

async function endRecord(blob: Blob): Promise<{ at: number; data: DataView }> {
  if (blob.size < EndRecord.Bytes) throw Error("File has no ZIP end record");
  const at = blob.size - EndRecord.Bytes;
  const data = view(await slice(blob, at, EndRecord.Bytes));
  if (
    data.getUint32(0, true) === Signature.End &&
    data.getUint16(EndRecord.CommentLength, true) === 0
  ) {
    return { at, data };
  }
  const start = Math.max(0, at - MAX_COMMENT_BYTES);
  const tail = await slice(blob, start, blob.size - start);
  const search = view(tail);
  let i = tail.length - EndRecord.Bytes;
  while (
    i >= 0 &&
    !(
      search.getUint32(i, true) === Signature.End &&
      i + EndRecord.Bytes + search.getUint16(i + EndRecord.CommentLength, true) === tail.length
    )
  ) {
    i--;
  }
  if (i < 0) throw Error("File has no valid ZIP end record");
  return { at: start + i, data: view(tail.subarray(i)) };
}

interface Zip64Directory extends ZipDirectory {
  at: number;
  localCount: number;
}

async function zip64Directory(blob: Blob, locator: DataView): Promise<Zip64Directory> {
  if (locator.getUint32(Locator.Disk, true) || locator.getUint32(Locator.Disks, true) !== 1) {
    throw Error("Multi-disk ZIP64 is unsupported");
  }
  const at = u64(locator, Locator.Offset);
  const fields = view(await slice(blob, at, Zip64End.Bytes));
  if (
    fields.getUint32(0, true) !== Signature.Zip64 ||
    fields.getUint32(Zip64End.DiskA, true) ||
    fields.getUint32(Zip64End.DiskB, true)
  ) {
    throw Error("Invalid ZIP64 end record");
  }
  const localCount = u64(fields, Zip64End.LocalCount);
  const count = u64(fields, Zip64End.Count);
  const size = u64(fields, Zip64End.Size);
  const start = u64(fields, Zip64End.Start);
  return { at, localCount, count, size, start };
}

async function directoryLocation(blob: Blob): Promise<ZipDirectory> {
  const { data, at: endAt } = await endRecord(blob);
  let at = endAt;
  const disk = data.getUint16(EndRecord.Disk, true),
    centralDisk = data.getUint16(EndRecord.CentralDisk, true);
  let localCount = data.getUint16(EndRecord.LocalCount, true),
    count = data.getUint16(EndRecord.Count, true);
  let size = data.getUint32(EndRecord.Size, true),
    start = data.getUint32(EndRecord.Start, true);
  if (disk || centralDisk) throw Error("Multi-disk ZIPs are unsupported");
  const saturated =
    size === SATURATED_32 ||
    start === SATURATED_32 ||
    count === SATURATED_16 ||
    localCount === SATURATED_16;
  const locator =
    saturated && at >= Locator.Bytes
      ? view(await slice(blob, at - Locator.Bytes, Locator.Bytes))
      : null;
  if (locator?.getUint32(0, true) === Signature.Locator) {
    ({ localCount, count, size, start, at } = await zip64Directory(blob, locator));
  }
  if (
    localCount !== count ||
    start > at ||
    size > at - start ||
    count > Math.floor(size / Central.Bytes)
  ) {
    throw Error("Invalid ZIP directory bounds");
  }
  if (size > MAX_DIRECTORY_BYTES) throw Error("ZIP directory exceeds 64 MiB");
  return { start, size, count };
}

function applyZip64(entry: CentralEntry, extra: Uint8Array): void {
  const data = view(extra);
  for (let at = 0; at + Extra.Header <= extra.length;) {
    const id = data.getUint16(at, true);
    const size = data.getUint16(at + Extra.Size, true);
    at += Extra.Header;
    if (size > extra.length - at) throw Error("Invalid ZIP extra field");
    if (id === Extra.Zip64Id) {
      const fields = view(extra.subarray(at, at + size));
      let position = 0;
      for (const key of ZIP64_KEYS) {
        if (entry[key] !== SATURATED_32) continue;
        entry[key] = u64(fields, position);
        position += Extra.FieldBytes;
      }
      return;
    }
    at += size;
  }
  throw Error("Missing ZIP64 entry sizes");
}

export function modifiedTime(date: number, time: number): number {
  return date
    ? Date.UTC(
        DosDate.BaseYear + (date >>> DosDate.YearShift),
        ((date >>> DosDate.MonthShift) & DosDate.Mask) - 1,
        date & DosDate.DayMask,
        time >>> DosTime.HourShift,
        (time >>> DosTime.MinuteShift) & DosTime.MinuteMask,
        (time & DosTime.SecondMask) * DosTime.SecondScale,
      )
    : 0;
}

async function centralEntries(blob: Blob, directory: ZipDirectory): Promise<CentralEntry[]> {
  const central = await slice(blob, directory.start, directory.size);
  const data = view(central);
  const found: CentralEntry[] = [];
  let at = 0;
  for (let index = 0; index < directory.count; index++) {
    if (at + Central.Bytes > central.length || data.getUint32(at, true) !== Signature.Central) {
      throw Error("Invalid ZIP directory entry");
    }
    const nameLen = data.getUint16(at + Central.NameLength, true),
      extraLen = data.getUint16(at + Central.ExtraLength, true),
      commentLen = data.getUint16(at + Central.CommentLength, true);
    const nameAt = at + Central.Bytes,
      extraAt = nameAt + nameLen,
      end = extraAt + extraLen + commentLen;
    if (end > central.length) throw Error("Truncated ZIP directory entry");
    if (data.getUint16(at + Central.Disk, true) !== 0) {
      throw Error("Multi-disk ZIP entries are unsupported");
    }
    const entry: CentralEntry = {
      rawPath: central.subarray(nameAt, extraAt),
      modified: modifiedTime(
        data.getUint16(at + Central.Date, true),
        data.getUint16(at + Central.Time, true),
      ),
      flags: data.getUint16(at + Central.Flags, true),
      method: data.getUint16(at + Central.Method, true),
      crc: data.getUint32(at + Central.Crc, true),
      compressedSize: data.getUint32(at + Central.CompressedSize, true),
      size: data.getUint32(at + Central.Size, true),
      offset: data.getUint32(at + Central.Offset, true),
    };
    if ([entry.size, entry.compressedSize, entry.offset].includes(SATURATED_32)) {
      applyZip64(entry, central.subarray(extraAt, extraAt + extraLen));
    }
    found.push(entry);
    at = end;
  }
  return found;
}

/** Archives cut off inside their central directory still have intact members before it. */
async function recoveredDirectory(
  blob: Blob,
  cause: unknown,
  diagnostic: Diagnostic | undefined,
): Promise<{ directory: ZipDirectory; found: CentralEntry[] }> {
  const recovery = await recoverLocalEntries(
    (start, length) => slice(blob, start, length),
    blob.size,
  );
  if (!recovery.entries.length) throw cause;
  diagnostic?.("warn", "ipa", "ZIP directory missing; rebuilt from member headers", {
    error: String(cause instanceof Error ? cause.message : cause),
    entries: recovery.entries.length,
    archiveBytes: blob.size,
  });
  return {
    directory: { start: recovery.end, size: 0, count: recovery.entries.length },
    found: recovery.entries.map((entry) => ({
      ...entry,
      modified: modifiedTime(entry.date, entry.time),
    })),
  };
}

export async function readDirectory(
  blob: Blob,
  diagnostic: Diagnostic | undefined,
): Promise<{ directory: ZipDirectory; found: CentralEntry[] }> {
  try {
    const directory = await directoryLocation(blob);
    diagnostic?.("info", "ipa", "Reading ZIP central directory", {
      offset: directory.start,
      bytes: directory.size,
      entries: directory.count,
    });
    return { directory, found: await centralEntries(blob, directory) };
  } catch (error) {
    if (!(error instanceof Error && RECOVERY_ERROR.test(error.message))) throw error;
    return recoveredDirectory(blob, error, diagnostic);
  }
}
