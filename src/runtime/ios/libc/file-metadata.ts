// ARMv7 Darwin uses 4-byte alignment for the 64-bit fields in stat and dirent.
const encoder = new TextEncoder();
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const VIRTUAL_INODE_FLAG = 0x8000000000000000n;
const INODE_BITS = 64;
const MILLISECONDS_PER_SECOND = 1000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const STAT_BLOCK_BYTES = 512;
const TIMESPEC_NANOSECONDS = 4;
const PREFERRED_IO_BYTES = 4096;
const Stat = {
  Bytes: 108,
  Device: 0,
  Mode: 4,
  Links: 6,
  Inode: 8,
  Accessed: 28,
  Modified: 36,
  Changed: 44,
  Created: 52,
  Size: 60,
  Blocks: 68,
  BlockSize: 76,
} as const;
const Dirent = {
  Inode: 0,
  Seek: 8,
  RecordLength: 16,
  NameLength: 18,
  Type: 20,
  Name: 21,
  Header: 22,
  NameLimit: 1024,
  Alignment: 4,
} as const;
const DirentType = { Directory: 4, Regular: 8 } as const;
export const DIRENT_BYTES = 1048;
export type Inode = bigint | number;
export interface FileStat {
  readonly device: number;
  readonly inode: Inode;
  readonly mode: number;
  readonly links?: number;
  readonly size?: number;
  readonly modified?: number;
  readonly created?: number;
}
export interface DirectoryEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly inode: Inode;
}

export function virtualInode(path: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(path))
    hash = BigInt.asUintN(INODE_BITS, (hash ^ BigInt(byte)) * FNV_PRIME);
  return hash | VIRTUAL_INODE_FLAG;
}

export function statBytes({
  device,
  inode,
  mode,
  links = 1,
  size = 0,
  modified = 0,
  created = modified,
}: FileStat): Uint8Array {
  const bytes = new Uint8Array(Stat.Bytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(Stat.Device, device, true);
  view.setUint16(Stat.Mode, mode, true);
  view.setUint16(Stat.Links, links, true);
  view.setBigUint64(Stat.Inode, BigInt(inode), true);
  for (const [offset, ms] of [
    [Stat.Accessed, modified],
    [Stat.Modified, modified],
    [Stat.Changed, modified],
    [Stat.Created, created],
  ] as const) {
    view.setInt32(offset, Math.floor(ms / MILLISECONDS_PER_SECOND), true);
    view.setUint32(
      offset + TIMESPEC_NANOSECONDS,
      (ms % MILLISECONDS_PER_SECOND) * NANOSECONDS_PER_MILLISECOND,
      true,
    );
  }
  view.setBigInt64(Stat.Size, BigInt(size), true);
  view.setBigInt64(Stat.Blocks, BigInt(Math.ceil(size / STAT_BLOCK_BYTES)), true);
  view.setInt32(Stat.BlockSize, PREFERRED_IO_BYTES, true);
  return bytes;
}

export function direntBytes(entry: DirectoryEntry, position: number): Uint8Array | null {
  const name = encoder.encode(entry.name);
  if (name.length >= Dirent.NameLimit) return null;
  const length = Math.ceil((Dirent.Header + name.length) / Dirent.Alignment) * Dirent.Alignment;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(Dirent.Inode, BigInt(entry.inode), true);
  view.setBigUint64(Dirent.Seek, BigInt(position), true);
  view.setUint16(Dirent.RecordLength, length, true);
  view.setUint16(Dirent.NameLength, name.length, true);
  view.setUint8(Dirent.Type, entry.dir ? DirentType.Directory : DirentType.Regular);
  bytes.set(name, Dirent.Name);
  return bytes;
}

/** Reads the fields of a guest `struct stat` that Foundation reports as file attributes. */
export function parseStat(bytes: Uint8Array): Required<FileStat> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const milliseconds = (offset: number) =>
    view.getInt32(offset, true) * MILLISECONDS_PER_SECOND +
    Math.floor(view.getUint32(offset + TIMESPEC_NANOSECONDS, true) / NANOSECONDS_PER_MILLISECOND);
  return {
    device: view.getInt32(Stat.Device, true),
    inode: view.getBigUint64(Stat.Inode, true),
    mode: view.getUint16(Stat.Mode, true),
    links: view.getUint16(Stat.Links, true),
    size: Number(view.getBigInt64(Stat.Size, true)),
    modified: milliseconds(Stat.Modified),
    created: milliseconds(Stat.Created),
  };
}
export const STAT_BYTES = Stat.Bytes;
