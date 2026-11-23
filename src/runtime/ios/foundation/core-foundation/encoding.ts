import { CFEncoding } from "../string-encodings";

const ASCII_MAX = 127;
const LATIN1_MAX = 255;
const UTF16_UNIT = 2;
const utf8 = new TextEncoder();

export function utf16Bytes(value: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(value.length * UTF16_UNIT),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i++)
    view.setUint16(i * UTF16_UNIT, value.charCodeAt(i), littleEndian);
  return bytes;
}

export function encoded(value: string, encoding: number): Uint8Array | null {
  if (encoding === CFEncoding.UTF8) return utf8.encode(value);
  if (encoding === CFEncoding.ASCII || encoding === CFEncoding.ISOLatin1) {
    const limit = encoding === CFEncoding.ASCII ? ASCII_MAX : LATIN1_MAX;
    const points = Array.from(value, (character) => character.codePointAt(0) ?? 0);
    return points.some((point) => point > limit) ? null : Uint8Array.from(points);
  }
  if (
    encoding === CFEncoding.Unicode ||
    encoding === CFEncoding.UTF16BE ||
    encoding === CFEncoding.UTF16LE
  )
    return utf16Bytes(value, encoding !== CFEncoding.UTF16BE);
  return null;
}
