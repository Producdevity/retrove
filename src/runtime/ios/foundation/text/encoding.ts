export const StringEncoding = {
  ASCII: 1,
  UTF8: 4,
  Latin1: 5,
  UTF16: 10,
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
