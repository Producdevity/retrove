import { Argument } from "../../objc/host";
import type { FoundationHost } from "../../objc/host";
const STRING_CLASS = "NSString";
const CHARACTER_BYTES = Uint16Array.BYTES_PER_ELEMENT;
const CHARACTERS_PER_CHUNK = 16384;
const MAX_CHARACTER_BYTES = 67108864;
interface CharacterHost extends Pick<FoundationHost, "method" | "text" | "alloc" | "autorelease"> {
  readBytes(pointer: number, length: number): Uint8Array;
  initialize(pointer: number, bytes: Uint8Array): number;
  writeBytes(pointer: number, bytes: Uint8Array): void;
}
export function decodeCharacterBytes(bytes: Uint8Array): string {
  if (bytes.length % CHARACTER_BYTES) throw new Error("Truncated NSString UTF-16 storage.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    parts: string[] = [];
  for (let at = 0; at < bytes.length; at += CHARACTERS_PER_CHUNK * CHARACTER_BYTES) {
    const count = Math.min(CHARACTERS_PER_CHUNK, (bytes.length - at) / CHARACTER_BYTES),
      characters = new Uint16Array(count);
    for (let index = 0; index < count; index++)
      characters[index] = view.getUint16(at + index * CHARACTER_BYTES, true);
    parts.push(String.fromCharCode(...characters));
  }
  return parts.join("");
}
function copyCharacters(
  host: CharacterHost,
  value: string,
  destination: number,
  start: number,
  length: number,
): void {
  if (start < 0 || length < 0 || start > value.length || length > value.length - start)
    throw new RangeError("NSString character range outside bounds.");
  if (length && !destination) throw new Error("NSString getCharacters requires an output buffer.");
  for (let at = 0; at < length; at += CHARACTERS_PER_CHUNK) {
    const count = Math.min(CHARACTERS_PER_CHUNK, length - at),
      bytes = new Uint8Array(count * CHARACTER_BYTES),
      view = new DataView(bytes.buffer);
    for (let index = 0; index < count; index++)
      view.setUint16(index * CHARACTER_BYTES, value.charCodeAt(start + at + index), true);
    host.writeBytes(destination + at * CHARACTER_BYTES, bytes);
  }
}
export function installStringCharacters(host: CharacterHost): void {
  for (const factory of [true, false]) {
    const selector = (factory ? "string" : "init") + "WithCharacters:length:";
    host.method(STRING_CLASS, factory, selector, (receiver, args) => {
      const pointer = args(0),
        length = args(1) * CHARACTER_BYTES;
      if (!Number.isSafeInteger(length) || length > MAX_CHARACTER_BYTES)
        throw new RangeError("NSString character input exceeds allocation limit.");
      if (length && !pointer) throw new Error("NSString characters require an input buffer.");
      const bytes = length ? host.readBytes(pointer, length) : new Uint8Array();
      const string = host.initialize(factory ? host.alloc(receiver) : receiver, bytes);
      return factory ? host.autorelease(string) : string;
    });
  }
  host.method(STRING_CLASS, false, "characterAtIndex:", (self, args) => {
    const value = host.text(self),
      index = args(0);
    if (index >= value.length) throw new RangeError("NSString index outside bounds.");
    return value.charCodeAt(index);
  });
  host.method(STRING_CLASS, false, "getCharacters:", (self, args) => {
    const value = host.text(self);
    copyCharacters(host, value, args(0), 0, value.length);
  });
  host.method(STRING_CLASS, false, "getCharacters:range:", (self, args) =>
    copyCharacters(host, host.text(self), args(0), args(1), args(Argument.Third)),
  );
}
