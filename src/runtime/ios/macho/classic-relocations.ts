import { WORD_BYTES } from "../abi/scalars";

const HeaderFlag = { Prebound: 0x10, SplitSegments: 0x20, TwoLevel: 0x80 } as const;
const SymbolField = { String: 0, Type: 4, Description: 6, Value: 8 } as const;
const SymbolKind = { Mask: 0x0e, Undefined: 0, PreboundUndefined: 0x0c } as const;
const SYMBOL_BYTES = 12;
const RELOCATION_BYTES = 8;
const RELOCATION_SYMBOL_MASK = 0x00ffffff;
const RELOCATION_FLAGS_SHIFT = 24;
const EXTERNAL_POINTER_FLAGS = 0x0c;
const SCATTERED_ADDRESS = 0x80000000;
const WEAK_REFERENCE = 0x40;
const ORDINAL_SHIFT = 8;
const FIRST_SPECIAL_ORDINAL = 0xfe;
const ORDINAL_MODULUS = 0x100;
const FLAT_LOOKUP_ORDINAL = -2;
const WRITE_PROTECTION = 2;
const MAX_ADDRESS = 0xffffffff;
const MAX_RELOCATIONS = 2_000_000;
const decoder = new TextDecoder("utf-8", { fatal: true });
interface Segment {
  address: number;
  size: number;
  fileOffset: number;
  fileSize: number;
  protection: number;
}
interface RelocationInput {
  bytes: Uint8Array;
  segments: readonly Segment[];
  dylibs: readonly string[];
  flags: number;
  symbols: DataView;
  strings: Uint8Array;
  relocations: DataView;
}
interface Binding {
  address: number;
  name: string;
  ordinal: number;
  library: string | null;
  kind: 1;
  weak: boolean;
  addend: number;
  mode: "normal";
}
function requireFormat(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(`Mach-O: ${detail}`);
}
export function classicRelocations(input: RelocationInput): Binding[] {
  const { bytes, segments, flags, relocations } = input;
  requireFormat(
    relocations.byteLength % RELOCATION_BYTES === 0 &&
      relocations.byteLength / RELOCATION_BYTES <= MAX_RELOCATIONS,
    "invalid external relocation table size",
  );
  if (!relocations.byteLength) return [];
  const base =
    flags & HeaderFlag.SplitSegments
      ? segments.find((segment) => Boolean(segment.protection & WRITE_PROTECTION))
      : segments[0];
  requireFormat(base !== undefined, "missing external relocation base");
  const image = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bindings: Binding[] = [];
  for (let offset = 0; offset < relocations.byteLength; offset += RELOCATION_BYTES) {
    const relative = relocations.getUint32(offset, true);
    const bits = relocations.getUint32(offset + WORD_BYTES, true);
    requireFormat(
      relative < SCATTERED_ADDRESS && bits >>> RELOCATION_FLAGS_SHIFT === EXTERNAL_POINTER_FLAGS,
      "unsupported ARM external relocation type",
    );
    const address = base.address + relative;
    const segment = segments.find(
      (candidate) =>
        candidate.protection !== 0 &&
        address >= candidate.address &&
        address + WORD_BYTES <= candidate.address + candidate.size,
    );
    requireFormat(
      segment !== undefined && address <= MAX_ADDRESS && address % WORD_BYTES === 0,
      "external relocation outside mapped image",
    );
    const position = address - segment.address;
    const filePosition = segment.fileOffset + position;
    let addend = 0;
    if (position < segment.fileSize) {
      requireFormat(
        position + WORD_BYTES <= segment.fileSize && filePosition + WORD_BYTES <= bytes.byteLength,
        "external relocation exceeds segment file data",
      );
      addend = image.getInt32(filePosition, true);
    }
    const { name, ordinal, library, weak, previous } = readSymbol(
      input,
      bits & RELOCATION_SYMBOL_MASK,
    );
    if (flags & HeaderFlag.Prebound) addend -= previous;
    bindings.push({
      address,
      name,
      ordinal,
      library,
      kind: 1,
      weak,
      addend,
      mode: "normal",
    });
  }
  return bindings;
}

function readSymbol({ symbols, strings, dylibs, flags }: RelocationInput, index: number) {
  const symbol = index * SYMBOL_BYTES;
  requireFormat(symbol + SYMBOL_BYTES <= symbols.byteLength, "invalid external relocation symbol");
  const kind = symbols.getUint8(symbol + SymbolField.Type) & SymbolKind.Mask;
  requireFormat(
    kind === SymbolKind.Undefined || kind === SymbolKind.PreboundUndefined,
    "unsupported defined external relocation symbol",
  );
  const description = symbols.getUint16(symbol + SymbolField.Description, true);
  const rawOrdinal = description >>> ORDINAL_SHIFT;
  const ordinal =
    flags & HeaderFlag.TwoLevel
      ? rawOrdinal >= FIRST_SPECIAL_ORDINAL
        ? rawOrdinal - ORDINAL_MODULUS
        : rawOrdinal
      : FLAT_LOOKUP_ORDINAL;
  requireFormat(ordinal <= dylibs.length, "invalid external relocation library ordinal");
  const start = symbols.getUint32(symbol + SymbolField.String, true);
  const end = strings.indexOf(0, start);
  requireFormat(start < strings.length && end > start, "invalid external relocation symbol name");
  return {
    name: decoder.decode(strings.subarray(start, end)),
    ordinal,
    library: dylibs[ordinal - 1] ?? null,
    weak: Boolean(description & WEAK_REFERENCE),
    previous: symbols.getUint32(symbol + SymbolField.Value, true),
  };
}
