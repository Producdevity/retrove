import { ARM_CPU_TYPE, requireFormat, sub, view } from "./format";

const THIN_MAGIC = 0xfeedface;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_SWAPPED = 0xbebafeca;
const MIN_FILE_BYTES = 4;
const FAT_HEADER_BYTES = 8;
const FAT_ENTRY_BYTES = 20;
const FatField = { Count: 4, Subtype: 4, Offset: 8, Size: 12 } as const;
const SUBTYPE_MASK = 0xffffff;
const ARM_V7_SUBTYPE = 9;

export function selectSlice(input: Uint8Array): Uint8Array {
  requireFormat(
    input instanceof Uint8Array && input.length >= MIN_FILE_BYTES,
    "truncated executable",
  );
  const d = view(input);
  if (d.getUint32(0, true) === THIN_MAGIC) return input;
  const magic = d.getUint32(0);
  requireFormat(
    [FAT_MAGIC, FAT_MAGIC_SWAPPED].includes(magic),
    "expected 32-bit ARM Mach-O executable",
  );
  const le = magic === FAT_MAGIC_SWAPPED;
  sub(input, 0, FAT_HEADER_BYTES, "fat header");
  const count = d.getUint32(FatField.Count, le);
  sub(input, FAT_HEADER_BYTES, count * FAT_ENTRY_BYTES, "fat architecture table");
  let fallback: Uint8Array | undefined;
  for (let i = 0; i < count; i++) {
    const at = FAT_HEADER_BYTES + i * FAT_ENTRY_BYTES;
    if (d.getUint32(at, le) !== ARM_CPU_TYPE) continue;
    const slice = sub(
      input,
      d.getUint32(at + FatField.Offset, le),
      d.getUint32(at + FatField.Size, le),
      "ARM slice",
    );
    if ((d.getUint32(at + FatField.Subtype, le) & SUBTYPE_MASK) === ARM_V7_SUBTYPE) return slice;
    fallback ??= slice;
  }
  requireFormat(fallback, "no 32-bit ARM slice");
  return fallback;
}
