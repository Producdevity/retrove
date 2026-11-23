import { write32, type GuestMemory } from "../../memory/guest-memory";
import type { GuestArguments } from "../objc/host";
import { Errno } from "./bsd-errno";
import { UINT32_MAX } from "./guest-imports";
import { asciiLower, asciiUpper, runeFlags } from "./rune-locale";
import { StringNumbers } from "./string-numbers";
import { GuestStrings, Width } from "./string-units";

export { defaultRuneLocale } from "./rune-locale";

export type StringImport = (a: GuestArguments) => number | bigint | undefined;

const BYTE_MASK = 0xff;
const ASCII_LIMIT = 128;
const PATTERN_BYTES = 16;
const PATTERN_CHUNK = 4096;
const Bits = { Word: 32, Long: 64 } as const;
const Arg = { Third: 2, Fourth: 3 } as const;

function memsetPattern(cpu: GuestMemory): StringImport {
  return (a) => {
    const n = a(Arg.Third);
    if (!n) return;
    const pattern = cpu.read(a(1), PATTERN_BYTES),
      chunk = new Uint8Array(Math.min(n, PATTERN_CHUNK));
    for (let i = 0; i < chunk.length; i++) chunk[i] = pattern[i % PATTERN_BYTES] ?? 0;
    for (let i = 0; i < n; i += chunk.length) cpu.write(a(0) + i, chunk.subarray(0, n - i));
  };
}

function multibyte(cpu: GuestMemory, errno: number, strings: GuestStrings): StringImport {
  return (a) => {
    const dest = a(0),
      capacity = dest ? a(Arg.Third) : Infinity;
    if (!capacity) return 0;
    let n = 0;
    for (const c of strings.units(a(1), Width.Wide)) {
      if (c < 0 || c >= ASCII_LIMIT) {
        write32(cpu, errno, Errno.IllegalSequence);
        return UINT32_MAX;
      }
      if (dest) cpu.write(dest + n, Uint8Array.of(c));
      if (!c) break;
      if (++n === capacity) break;
    }
    return n;
  };
}

function tokenizer(cpu: GuestMemory, strings: GuestStrings): StringImport {
  let cursor = 0;
  return (a) => {
    let p = a(0) || cursor;
    if (!p) return 0;
    const delimiters = strings.members(a(1), Width.Narrow);
    for (const c of strings.units(p, Width.Narrow)) {
      if (!c) {
        cursor = 0;
        return 0;
      }
      if (!delimiters.has(c)) break;
      p++;
    }
    const { n, found } = strings.scan(p, Width.Narrow, delimiters);
    cursor = found ? p + n + 1 : 0;
    if (found) cpu.write(p + n, Uint8Array.of(0));
    return p;
  };
}

function narrowImports(strings: GuestStrings): Record<string, StringImport> {
  const { Narrow } = Width;
  return {
    _memchr: (a) => strings.findChar(a(0), a(1) & BYTE_MASK, Narrow, false, a(Arg.Third)),
    _strncmp: (a) => strings.compare(a(0), a(1), Narrow, a(Arg.Third), false),
    _strcasecmp: (a) => strings.compare(a(0), a(1), Narrow, undefined, true),
    _strncasecmp: (a) => strings.compare(a(0), a(1), Narrow, a(Arg.Third), true),
    _strncat: (a) => strings.copy(a(0), a(1), Narrow, a(Arg.Third), true),
    _strcoll: (a) => strings.compare(a(0), a(1), Narrow, undefined, false),
    _strrchr: (a) => strings.findChar(a(0), a(1) & BYTE_MASK, Narrow, true),
    _strcspn: (a) => strings.scan(a(0), Narrow, strings.members(a(1), Narrow)).n,
    ___strcpy_chk: (a) => strings.copy(a(0), a(1), Narrow, undefined, false, a(Arg.Third)),
    ___strncpy_chk: (a) => strings.copy(a(0), a(1), Narrow, a(Arg.Third), false, a(Arg.Fourth)),
    ___strcat_chk: (a) => strings.copy(a(0), a(1), Narrow, undefined, true, a(Arg.Third)),
    ___strncat_chk: (a) => strings.copy(a(0), a(1), Narrow, a(Arg.Third), true, a(Arg.Fourth)),
    _wcscmp: (a) => strings.compare(a(0), a(1), Width.Wide, undefined, false),
    ___maskrune: (a) => runeFlags(a(0) | 0) & a(1),
    ___toupper: (a) => asciiUpper(a(0)),
    ___tolower: (a) => asciiLower(a(0)),
  };
}

function familyImports(
  strings: GuestStrings,
  prefix: string,
  width: number,
): Record<string, StringImport> {
  const character = (a: GuestArguments) => (width === Width.Narrow ? a(1) & BYTE_MASK : a(1) | 0);
  return {
    [prefix + "len"]: (a) => strings.length(a(0), width),
    [prefix + "cpy"]: (a) => strings.copy(a(0), a(1), width, undefined, false),
    [prefix + "ncpy"]: (a) => strings.copy(a(0), a(1), width, a(Arg.Third), false),
    [prefix + "cat"]: (a) => strings.copy(a(0), a(1), width, undefined, true),
    [prefix + "chr"]: (a) => strings.findChar(a(0), character(a), width),
    [prefix + "str"]: (a) => strings.substring(a(0), a(1), width),
    [prefix + "pbrk"]: (a) => {
      const { n, found } = strings.scan(a(0), width, strings.members(a(1), width));
      return found ? a(0) + n * width : 0;
    },
  };
}

function numberImports(
  cpu: GuestMemory,
  errno: number,
  strings: GuestStrings,
): Record<string, StringImport> {
  const numbers = new StringNumbers(cpu, errno, (address, width) => strings.units(address, width));
  const unsigned = (a: GuestArguments, width: number, bits: number) =>
    numbers.unsigned(a(0), a(1), a(Arg.Third), width, bits);
  return {
    _strtoul: (a) => Number(unsigned(a, Width.Narrow, Bits.Word)),
    _strtoull: (a) => unsigned(a, Width.Narrow, Bits.Long),
    _wcstoul: (a) => Number(unsigned(a, Width.Wide, Bits.Word)),
    _strtod: (a) => numbers.real(a(0), a(1)),
    _atof: (a) => numbers.real(a(0), 0),
  };
}

/** C string and wide-string imports over guest memory; `errno` is the guest address strtol-style functions set. */
export function stringImports(cpu: GuestMemory, errno: number): Record<string, StringImport> {
  const strings = new GuestStrings(cpu);
  return {
    ...numberImports(cpu, errno, strings),
    _wcstombs: multibyte(cpu, errno, strings),
    _memset_pattern16: memsetPattern(cpu),
    _strtok: tokenizer(cpu, strings),
    ...narrowImports(strings),
    ...familyImports(strings, "_str", Width.Narrow),
    ...familyImports(strings, "_wcs", Width.Wide),
  };
}
