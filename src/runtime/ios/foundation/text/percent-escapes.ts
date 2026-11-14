import { decodeText, encodeURLCharacter, StringEncoding } from "./encoding";
const URL_SAFE = /^[A-Za-z0-9;/?:@&=+$,_.!~*'()-]$/;
const HEX_PAIR = /^[0-9a-fA-F]{2}$/;
const HEX_RADIX = 16,
  HEX_DIGITS = 2,
  ESCAPE_BYTES = 3;
const ENCODINGS = new Set<number>([
  StringEncoding.ASCII,
  StringEncoding.UTF8,
  StringEncoding.Latin1,
]);
export function addPercentEscapes(value: string, encoding: number): string | null {
  if (!ENCODINGS.has(encoding)) return null;
  const pieces: string[] = [];
  for (const character of value) {
    if (URL_SAFE.test(character)) {
      pieces.push(character);
      continue;
    }
    const bytes = encodeURLCharacter(character, encoding);
    if (!bytes) return null;
    for (const byte of bytes)
      pieces.push("%" + byte.toString(HEX_RADIX).padStart(HEX_DIGITS, "0").toUpperCase());
  }
  return pieces.join("");
}
export function replacePercentEscapes(value: string, encoding: number): string | null {
  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const escaped = value.indexOf("%", cursor);
    if (escaped < 0) {
      pieces.push(value.slice(cursor));
      break;
    }
    pieces.push(value.slice(cursor, escaped));
    cursor = escaped;
    const bytes: number[] = [];
    while (value.charAt(cursor) === "%") {
      const pair = value.slice(cursor + 1, cursor + ESCAPE_BYTES);
      if (!HEX_PAIR.test(pair)) return null;
      bytes.push(Number.parseInt(pair, HEX_RADIX));
      cursor += ESCAPE_BYTES;
    }
    const decoded = decodeText(Uint8Array.from(bytes), encoding);
    if (decoded === null) return null;
    pieces.push(decoded);
  }
  return pieces.join("");
}
