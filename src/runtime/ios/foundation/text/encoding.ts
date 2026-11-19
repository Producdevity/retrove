export const StringEncoding = {
  ASCII: 1,
  UTF8: 4,
  Latin1: 5,
  UTF16: 10,
  MacRoman: 30,
  UTF16BE: 0x90000100,
  UTF16LE: 0x94000100,
} as const;
const ASCII_MAX = 0x7f,
  LATIN1_MAX = 0xff,
  SURROGATE_FIRST = 0xd800,
  SURROGATE_LAST = 0xdfff;
const encoder = new TextEncoder();
const decoders = new Map<number, string>([
  [StringEncoding.ASCII, "utf-8"],
  [StringEncoding.UTF8, "utf-8"],
  [StringEncoding.UTF16, "utf-16le"],
  [StringEncoding.MacRoman, "macintosh"],
  [StringEncoding.UTF16BE, "utf-16be"],
  [StringEncoding.UTF16LE, "utf-16le"],
]);
export function decodeText(bytes: Uint8Array, encoding: number): string | null {
  if (encoding === StringEncoding.ASCII && bytes.some((byte) => byte > ASCII_MAX)) return null;
  if (encoding === StringEncoding.Latin1)
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const decoder = decoders.get(encoding);
  if (!decoder) return null;
  try {
    return new TextDecoder(decoder, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
export function encodeURLCharacter(character: string, encoding: number): Uint8Array | null {
  const code = character.charCodeAt(0);
  if (encoding === StringEncoding.UTF8) {
    if (character.length === 1 && code >= SURROGATE_FIRST && code <= SURROGATE_LAST) return null;
    return encoder.encode(character);
  }
  const limit =
    encoding === StringEncoding.ASCII
      ? ASCII_MAX
      : encoding === StringEncoding.Latin1
        ? LATIN1_MAX
        : -1;
  return character.length === 1 && code <= limit ? Uint8Array.of(code) : null;
}
const UTF16_BYTES = 2,
  BYTE_BITS = 8,
  BYTE_MASK = 0xff,
  BYTE_ORDER_MARK = 0xfeff;
function utf16(value: string, littleEndian: boolean, mark: boolean): Uint8Array {
  const units = mark ? String.fromCharCode(BYTE_ORDER_MARK) + value : value;
  const bytes = new Uint8Array(units.length * UTF16_BYTES);
  for (let index = 0; index < units.length; index++) {
    const unit = units.charCodeAt(index),
      high = unit >> BYTE_BITS,
      low = unit & BYTE_MASK;
    bytes[index * UTF16_BYTES] = littleEndian ? low : high;
    bytes[index * UTF16_BYTES + 1] = littleEndian ? high : low;
  }
  return bytes;
}
/** Bytes for a whole string, or null when `encoding` cannot represent it losslessly. */
export function encodeText(value: string, encoding: number): Uint8Array | null {
  switch (encoding) {
    case StringEncoding.UTF8:
      return encoder.encode(value);
    case StringEncoding.UTF16:
      return utf16(value, true, true);
    case StringEncoding.UTF16LE:
      return utf16(value, true, false);
    case StringEncoding.UTF16BE:
      return utf16(value, false, false);
    case StringEncoding.ASCII:
    case StringEncoding.Latin1: {
      const limit = encoding === StringEncoding.ASCII ? ASCII_MAX : LATIN1_MAX;
      const codes = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
      return codes.every((code) => code <= limit) ? Uint8Array.from(codes) : null;
    }
    default:
      return null;
  }
}
