import { Argument } from "../../objc/host";
import { installLocalizedComparisons } from "../text/localized-comparison";
import type { GuestArguments } from "../../objc/host";
import {
  ASCII_MAX,
  BYTES_PER_WORD,
  NOT_FOUND,
  StringCompare,
  StringEncoding,
  UTF16_FAMILY_START,
  UTF16_UNIT_BYTES,
  MAX_BYTE,
} from "./constants";
import type { FoundationContext } from "./types";

const STRING = "NSString";

function encodedBytes(value: string, encoding: number): Uint8Array | null {
  if (
    encoding === StringEncoding.UTF8 ||
    (encoding === StringEncoding.ASCII &&
      value.split("").every((c) => c.charCodeAt(0) <= ASCII_MAX))
  ) {
    return new TextEncoder().encode(value);
  }
  if (
    encoding === StringEncoding.Latin1 &&
    value.split("").every((char) => char.charCodeAt(0) <= MAX_BYTE)
  ) {
    return Uint8Array.from(value, (char) => char.charCodeAt(0));
  }
  const wide: number[] = [
    StringEncoding.UTF16,
    StringEncoding.UTF16BigEndian,
    StringEncoding.UTF16LittleEndian,
  ];
  if (!wide.includes(encoding)) return null;
  const view = new DataView(new ArrayBuffer(value.length * UTF16_UNIT_BYTES));
  for (let index = 0; index < value.length; index++) {
    const littleEndian = encoding !== StringEncoding.UTF16BigEndian;
    view.setUint16(index * UTF16_UNIT_BYTES, value.charCodeAt(index), littleEndian);
  }
  return new Uint8Array(view.buffer);
}

function installEncodings(ctx: FoundationContext): void {
  const { method, text, cpu } = ctx;
  const encoded = (self: number, encoding: number) => encodedBytes(text(self), encoding);
  method(STRING, false, "cStringUsingEncoding:", (self, args) =>
    args(0) === StringEncoding.UTF8 ||
    (args(0) === StringEncoding.ASCII && encoded(self, StringEncoding.ASCII))
      ? ctx.utf8(self)
      : 0,
  );
  method(STRING, false, "getCString:maxLength:encoding:", (self, args) => {
    const bytes = encoded(self, args(Argument.Third));
    const wide =
      args(Argument.Third) === StringEncoding.UTF16 || args(Argument.Third) >= UTF16_FAMILY_START;
    const terminator = wide ? UTF16_UNIT_BYTES : 1;
    if (!args(0) || !bytes || bytes.length + terminator > args(1)) return 0;
    cpu.write(args(0), bytes);
    cpu.write(args(0) + bytes.length, new Uint8Array(terminator));
    return 1;
  });
  method(
    STRING,
    false,
    "lengthOfBytesUsingEncoding:",
    (self, args) => encoded(self, args(0))?.length ?? 0,
  );
}

function sensitivityFor(flags: number): Intl.CollatorOptions["sensitivity"] {
  const insensitive = Boolean(flags & StringCompare.CaseInsensitive);
  const diacriticInsensitive = Boolean(flags & StringCompare.DiacriticInsensitive);
  if (insensitive) return diacriticInsensitive ? "base" : "accent";
  return diacriticInsensitive ? "case" : "variant";
}

function locate(haystack: string, needle: string, flags: number): [number, number] {
  let hay = haystack;
  let target = needle;
  if (flags & StringCompare.CaseInsensitive) {
    hay = hay.toLowerCase();
    target = target.toLowerCase();
  }
  const backwards = Boolean(flags & StringCompare.Backwards);
  let at = backwards ? hay.lastIndexOf(target) : hay.indexOf(target);
  const anchored = backwards ? hay.length - target.length : 0;
  if (flags & StringCompare.Anchored && at !== anchored) at = -1;
  return [at, target.length];
}

function installComparisons(ctx: FoundationContext): void {
  const { method, text, write } = ctx;
  method(STRING, false, "compare:", (self, args) =>
    Math.sign(text(self).localeCompare(text(args(0)))),
  );
  method(STRING, false, "compare:options:", (self, args) => {
    const flags = args(1);
    const options = {
      numeric: Boolean(flags & StringCompare.Numeric),
      sensitivity: sensitivityFor(flags),
    };
    return Math.sign(text(self).localeCompare(text(args(0)), undefined, options));
  });
  for (const [selector, withOptions] of [
    ["rangeOfString:", false],
    ["rangeOfString:options:", true],
  ] as const) {
    const range = (self: number, args: GuestArguments, destination: number) => {
      const [at, length] = locate(text(self), text(args(0)), withOptions ? args(1) : 0);
      write(destination, at < 0 ? NOT_FOUND : at);
      write(destination + BYTES_PER_WORD, at < 0 ? 0 : length);
    };
    ctx.structureMethod(STRING, false, selector, Object.assign(range, { stret: true as const }));
  }
}

export function installStringSearch(ctx: FoundationContext): void {
  const { method, text, string } = ctx;
  installEncodings(ctx);
  installComparisons(ctx);
  method(STRING, false, "substringFromIndex:", (self, args) => string(text(self).slice(args(0))));
  method(STRING, false, "substringToIndex:", (self, args) => string(text(self).slice(0, args(0))));
  method(STRING, false, "substringWithRange:", (self, args) =>
    string(text(self).slice(args(0), args(0) + args(1))),
  );
  method(STRING, false, "uppercaseString", (self) => string(text(self).toUpperCase()));
  method(STRING, false, "lowercaseString", (self) => string(text(self).toLowerCase()));
  installLocalizedComparisons({ method, text }, ctx.h.languages()[0]);
  method(STRING, false, "caseInsensitiveCompare:", (self, args) =>
    Math.sign(
      text(self)
        .toLowerCase()
        .localeCompare(text(args(0)).toLowerCase()),
    ),
  );
}
