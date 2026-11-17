const POLYNOMIAL = 0xedb88320;
const TABLE_SIZE = 256;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
export const crcTable = Uint32Array.from({ length: TABLE_SIZE }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < BITS_PER_BYTE; bit++)
    value = (value >>> 1) ^ (value & 1 ? POLYNOMIAL : 0);
  return value >>> 0;
});
export function crc32(initial: number, bytes: Uint8Array): number {
  let crc = ~initial;
  for (const byte of bytes)
    crc = (crc >>> BITS_PER_BYTE) ^ (crcTable[(crc ^ byte) & BYTE_MASK] ?? 0);
  return ~crc >>> 0;
}
