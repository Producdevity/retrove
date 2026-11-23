import {
  CFEncoding,
  cfEncodingFor,
  encodingForIanaName,
  ianaNameFor,
  leadingInteger,
  nsEncodingFor,
} from "../string-encodings";
import { encoded, utf16Bytes } from "./encoding";
import { Argument, type CoreFoundationFunction, type CoreFoundationHost } from "./types";

const UTF16_UNIT = 2;
const STRING_FLAGS_OFFSET = 4;
const STRING_CHARACTERS_OFFSET = 8;
const INLINE_CHARACTERS_FLAG = 16;

export function stringFunctions(host: CoreFoundationHost): Record<string, CoreFoundationFunction> {
  const { cpu, text, makeString, makeUTF16, read } = host;
  return {
    _CFStringCreateWithCharacters: (a) =>
      a(0) ? 0 : makeUTF16(cpu.read(a(1), a(Argument.Third) * UTF16_UNIT)),
    _CFStringAppendCharacters: (a) => {
      const pointer = a(0),
        count = a(Argument.Third) * UTF16_UNIT,
        old = utf16Bytes(text(pointer), true);
      const bytes = new Uint8Array(old.length + count);
      bytes.set(old);
      bytes.set(cpu.read(a(1), count), old.length);
      makeUTF16(bytes, pointer);
    },
    _CFStringGetCharactersPtr: (a) =>
      read(a(0) + STRING_FLAGS_OFFSET) & INLINE_CHARACTERS_FLAG
        ? read(a(0) + STRING_CHARACTERS_OFFSET)
        : 0,
    _CFStringGetCString: (a) => {
      const bytes = encoded(text(a(0)), a(Argument.Fourth)),
        capacity = a(Argument.Third) | 0;
      if (!a(1) || !bytes || capacity <= bytes.length) return 0;
      cpu.write(a(1), bytes);
      cpu.write(a(1) + bytes.length, new Uint8Array(1));
      return 1;
    },
    _CFStringGetIntValue: (a) => (a(0) ? leadingInteger(text(a(0))) : 0),
    _CFStringConvertEncodingToNSStringEncoding: (a) => nsEncodingFor(a(0)),
    _CFStringConvertNSStringEncodingToEncoding: (a) => cfEncodingFor(a(0)),
    _CFStringConvertEncodingToIANACharSetName: (a) => {
      const name = ianaNameFor(a(0));
      return name ? makeString(name) : 0;
    },
    _CFStringConvertIANACharSetNameToEncoding: (a) =>
      a(0) ? encodingForIanaName(text(a(0))) : CFEncoding.Invalid,
    _CFStringGetSystemEncoding: () => 0,
  };
}
