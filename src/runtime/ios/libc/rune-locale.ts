import type { GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";

const Ascii = {
  Tab: 9,
  CarriageReturn: 13,
  Space: 32,
  Zero: 48,
  Nine: 57,
  UpperA: 65,
  UpperZ: 90,
  LowerA: 97,
  LowerF: 102,
  LowerZ: 122,
  Delete: 127,
  CaseOffset: 32,
  HexLetterBase: 87,
} as const;
const RuneFlag = {
  Alpha: 0x100,
  Control: 0x200,
  Digit: 0x400,
  Graphic: 0x800,
  Lower: 0x1000,
  Punctuation: 0x2000,
  Space: 0x4000,
  Upper: 0x8000,
  Hex: 0x10000,
  Blank: 0x20000,
  Print: 0x40000,
} as const;
const RuneTable = {
  Size: 3164,
  Replacement: 48,
  Flags: 52,
  Lower: 1076,
  Upper: 2100,
  Entries: 256,
} as const;
const REPLACEMENT_CHARACTER = 0xfffd;
const MAX_ASCII = 127;

export function asciiLower(c: number): number {
  return c >= Ascii.UpperA && c <= Ascii.UpperZ ? c + Ascii.CaseOffset : c;
}

export function asciiUpper(c: number): number {
  return c >= Ascii.LowerA && c <= Ascii.LowerZ ? c - Ascii.CaseOffset : c;
}

export function runeFlags(c: number): number {
  if (c < 0 || c > MAX_ASCII) return 0;
  const upper = c >= Ascii.UpperA && c <= Ascii.UpperZ,
    lower = c >= Ascii.LowerA && c <= Ascii.LowerZ;
  const alpha = upper || lower,
    digit = c >= Ascii.Zero && c <= Ascii.Nine;
  const print = c >= Ascii.Space && c < Ascii.Delete,
    graphic = print && c !== Ascii.Space;
  const hex = digit || (asciiLower(c) >= Ascii.LowerA && asciiLower(c) <= Ascii.LowerF);
  const space = c === Ascii.Space || (c >= Ascii.Tab && c <= Ascii.CarriageReturn);
  let flags = 0;
  if (alpha) flags |= RuneFlag.Alpha;
  if (c < Ascii.Space || c === Ascii.Delete) flags |= RuneFlag.Control;
  if (digit) flags |= RuneFlag.Digit;
  if (graphic) flags |= RuneFlag.Graphic;
  if (lower) flags |= RuneFlag.Lower;
  if (graphic && !alpha && !digit) flags |= RuneFlag.Punctuation;
  if (space) flags |= RuneFlag.Space;
  if (upper) flags |= RuneFlag.Upper;
  if (hex) flags |= RuneFlag.Hex | (digit ? c - Ascii.Zero : asciiLower(c) - Ascii.HexLetterBase);
  if (c === Ascii.Space || c === Ascii.Tab) flags |= RuneFlag.Blank;
  if (print) flags |= RuneFlag.Print;
  return flags;
}

// Darwin ARMv7 ctype.h reads these tables directly when the character fits in a byte.
export function defaultRuneLocale(
  cpu: GuestMemory,
  heap: { alloc(bytes: number): number },
): number {
  const bytes = new Uint8Array(RuneTable.Size),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RuneMagANONE"));
  view.setUint32(RuneTable.Replacement, REPLACEMENT_CHARACTER, true);
  for (let c = 0; c < RuneTable.Entries; c++) {
    view.setUint32(RuneTable.Flags + WORD_BYTES * c, runeFlags(c), true);
    view.setUint32(RuneTable.Lower + WORD_BYTES * c, asciiLower(c), true);
    view.setUint32(RuneTable.Upper + WORD_BYTES * c, asciiUpper(c), true);
  }
  const addr = heap.alloc(bytes.length);
  if (!addr) throw new Error("Guest heap exhausted while creating the default rune locale");
  cpu.write(addr, bytes);
  return addr;
}
