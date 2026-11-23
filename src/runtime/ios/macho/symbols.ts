import { SymbolIndex } from "../../diagnostics/symbol-index";
import { WORD_BYTES } from "../abi/scalars";
import { classicRelocations } from "./classic-relocations";
import { readCString, requireFormat, SYMBOL_BYTES, sub, view, word } from "./format";
import type { ImageTables, SymbolMatch } from "./image";
import { SectionType } from "./segment";

const RELOCATION_BYTES = 8;
const MAX_IMPORTS = 2_000_000;
const SymtabField = { SymbolOffset: 8, SymbolCount: 12, StringOffset: 16, StringSize: 20 } as const;
const DysymtabField = {
  IndirectOffset: 56,
  IndirectCount: 60,
  RelocationOffset: 64,
  RelocationCount: 68,
} as const;
const SymbolEntry = { String: 0, Description: 6 } as const;
const SPECIAL_INDEX_MASK = 0xc0000000;
const ORDINAL_SHIFT = 8;
const FIRST_SPECIAL_ORDINAL = 0xfd;
const ORDINAL_MODULUS = 0x100;
const WEAK_REFERENCE = 0x40;

function indirectBindings(
  image: ImageTables,
  symbols: DataView,
  strings: Uint8Array,
  indices: DataView,
): void {
  for (const seg of image.segments) {
    for (const s of seg.sections) {
      if (s.type !== SectionType.GlobalOffsetTable && s.type !== SectionType.LazyPointers) {
        continue;
      }
      requireFormat(
        s.size % WORD_BYTES === 0 && s.reserved1 * WORD_BYTES + s.size <= indices.byteLength,
        "invalid indirect section",
      );
      for (let pos = 0; pos < s.size; pos += WORD_BYTES) {
        const index = word(indices, s.reserved1 * WORD_BYTES + pos);
        if (index & SPECIAL_INDEX_MASK) continue;
        const at = index * SYMBOL_BYTES;
        requireFormat(at + SYMBOL_BYTES <= symbols.byteLength, "invalid symbol index");
        const desc = symbols.getUint16(at + SymbolEntry.Description, true),
          raw = desc >>> ORDINAL_SHIFT;
        const ordinal = raw > FIRST_SPECIAL_ORDINAL ? raw - ORDINAL_MODULUS : raw;
        requireFormat(ordinal <= image.dylibs.length, "invalid indirect symbol ordinal");
        const name = readCString(strings, word(symbols, at + SymbolEntry.String)).value;
        const address = s.address + pos;
        requireFormat(name && image.imports.length < MAX_IMPORTS, "invalid indirect import");
        image.imports.push({
          address,
          name,
          ordinal,
          library: image.dylibs[ordinal - 1] ?? null,
          kind: 1,
          weak: Boolean(desc & WEAK_REFERENCE),
          addend: 0,
          mode: s.type === SectionType.GlobalOffsetTable ? "normal" : "lazy",
        });
      }
    }
  }
}

export function readIndirect(
  image: ImageTables,
  sym: DataView | undefined,
  dysym: DataView | undefined,
  flags: number,
): void {
  if (!sym || !dysym) return;
  const symbols = view(
    sub(
      image.bytes,
      word(sym, SymtabField.SymbolOffset),
      word(sym, SymtabField.SymbolCount) * SYMBOL_BYTES,
      "symbol table",
    ),
  );
  const strings = sub(
    image.bytes,
    word(sym, SymtabField.StringOffset),
    word(sym, SymtabField.StringSize),
    "string table",
  );
  const relocations = view(
    sub(
      image.bytes,
      word(dysym, DysymtabField.RelocationOffset),
      word(dysym, DysymtabField.RelocationCount) * RELOCATION_BYTES,
      "external relocations",
    ),
  );
  for (const binding of classicRelocations({ ...image, flags, symbols, strings, relocations })) {
    image.imports.push(binding);
  }
  const indices = view(
    sub(
      image.bytes,
      word(dysym, DysymtabField.IndirectOffset),
      word(dysym, DysymtabField.IndirectCount) * WORD_BYTES,
      "indirect symbols",
    ),
  );
  indirectBindings(image, symbols, strings, indices);
}

export function symbolLookup(
  image: ImageTables,
  command: DataView | undefined,
): (target: number) => SymbolMatch | undefined {
  if (!command) return () => undefined;
  const list = sub(
    image.bytes,
    word(command, SymtabField.SymbolOffset),
    SYMBOL_BYTES * word(command, SymtabField.SymbolCount),
    "symbol table",
  );
  const names = sub(
    image.bytes,
    word(command, SymtabField.StringOffset),
    word(command, SymtabField.StringSize),
    "string table",
  );
  const sections = image.segments.flatMap((segment) => segment.sections);
  let index: SymbolIndex | undefined;
  return (target) => (index ??= new SymbolIndex(list, names, sections)).lookup(target);
}
