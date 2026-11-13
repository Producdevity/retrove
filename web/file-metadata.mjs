// ARMv7 Darwin uses 4-byte alignment for the 64-bit fields in stat and dirent.
const encoder = new TextEncoder();

export function virtualInode(path) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(path)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash | 0x8000000000000000n;
}

export function statBytes({device, inode, mode, links = 1, size = 0, modified = 0, created = modified}) {
  const bytes = new Uint8Array(108);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, device, true);
  view.setUint16(4, mode, true);
  view.setUint16(6, links, true);
  view.setBigUint64(8, BigInt(inode), true);
  for (const [offset, ms] of [[28, modified], [36, modified], [44, modified], [52, created]]) {
    view.setInt32(offset, Math.floor(ms / 1000), true);
    view.setUint32(offset + 4, (ms % 1000) * 1000000, true);
  }
  view.setBigInt64(60, BigInt(size), true);
  view.setBigInt64(68, BigInt(Math.ceil(size / 512)), true);
  view.setInt32(76, 4096, true);
  return bytes;
}

export const DIRENT_BYTES = 1048;
export function direntBytes(entry, position) {
  const name = encoder.encode(entry.name);
  if (name.length >= 1024) return null;
  const length = Math.ceil((22 + name.length) / 4) * 4;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(entry.inode), true);
  view.setBigUint64(8, BigInt(position), true);
  view.setUint16(16, length, true);
  view.setUint16(18, name.length, true);
  view.setUint8(20, entry.dir ? 4 : 8);
  bytes.set(name, 21);
  return bytes;
}
