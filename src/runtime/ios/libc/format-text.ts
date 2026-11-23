import { read32, readCStringBytes, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { byteString } from "./byte-string";

const PAGE_BYTES = 4096;
const utf8 = new TextEncoder();

export function narrow(cpu: GuestMemory, at: number, limit?: number): string {
  if (limit === undefined) return byteString(readCStringBytes(cpu, at));
  let text = "";
  while (text.length < limit) {
    const position = at + text.length,
      part = cpu.read(
        position,
        Math.min(PAGE_BYTES - (position % PAGE_BYTES), limit - text.length),
      );
    const end = part.indexOf(0);
    if (end !== -1) return text + byteString(part.subarray(0, end));
    text += byteString(part);
  }
  return text;
}

export function wide(cpu: GuestMemory, start: number, limit = Infinity): string {
  let text = "",
    at = start;
  while (text.length < limit) {
    const codePoint = read32(cpu, at);
    at += WORD_BYTES;
    if (!codePoint) break;
    const bytes = utf8.encode(String.fromCodePoint(codePoint));
    if (text.length + bytes.length > limit) break;
    text += byteString(bytes);
  }
  return text;
}

export function utf8Bytes(text: string): string {
  return byteString(utf8.encode(text));
}
