const ENTRY_BYTES = 12;
const SymbolField = { Name: 0, Kind: 4, Section: 5, Address: 8 } as const;
const SECTION_SYMBOL_MASK = 0xee;
const SECTION_SYMBOL = 0x0e;
const MAX_NAME_BYTES = 512;
const THUMB_ALIGNMENT = 2;
const BINARY_SEARCH_DIVISOR = 2;
interface Section {
  readonly address: number;
  readonly size: number;
}
interface Entry {
  readonly address: number;
  readonly nameOffset: number;
}
export class SymbolIndex {
  private readonly sections: readonly { section: Section; entries: readonly Entry[] }[];
  private readonly names = new Map<number, string>();
  private readonly strings: Uint8Array;
  constructor(table: Uint8Array, strings: Uint8Array, sections: readonly Section[]) {
    this.strings = strings;
    if (table.byteLength % ENTRY_BYTES) throw new Error("Invalid Mach-O symbol table size.");
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const entries = sections.map(() => new Map<number, Entry>());
    for (let offset = 0; offset < table.byteLength; offset += ENTRY_BYTES) {
      const sectionIndex = view.getUint8(offset + SymbolField.Section) - 1;
      const section = sections[sectionIndex],
        index = entries[sectionIndex];
      if (
        !section ||
        !index ||
        (view.getUint8(offset + SymbolField.Kind) & SECTION_SYMBOL_MASK) !== SECTION_SYMBOL
      )
        continue;
      const address = view.getUint32(offset + SymbolField.Address, true);
      const nameOffset = view.getUint32(offset + SymbolField.Name, true);
      if (
        address < section.address ||
        address >= section.address + section.size ||
        !nameOffset ||
        !strings[nameOffset] ||
        index.has(address)
      )
        continue;
      index.set(address, { address, nameOffset });
    }
    this.sections = sections.map((section, index) => ({
      section,
      entries: [...(entries[index]?.values() ?? [])].sort(
        (left, right) => left.address - right.address,
      ),
    }));
  }
  private name(offset: number): string {
    let name = this.names.get(offset);
    if (name !== undefined) return name;
    const prefix = this.strings.subarray(offset, offset + MAX_NAME_BYTES + 1);
    const end = prefix.indexOf(0);
    name = new TextDecoder().decode(prefix.subarray(0, end < 0 ? MAX_NAME_BYTES : end));
    if (end < 0) name += "…";
    this.names.set(offset, name);
    return name;
  }
  lookup(target: number): { name: string; offset: number } | undefined {
    const address = target - (target % THUMB_ALIGNMENT);
    const match = this.sections.find(
      ({ section }) => address >= section.address && address < section.address + section.size,
    );
    if (!match) return undefined;
    let low = 0,
      high = match.entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / BINARY_SEARCH_DIVISOR);
      const entry = match.entries[middle];
      if (entry && entry.address <= address) low = middle + 1;
      else high = middle;
    }
    const entry = match.entries[low - 1];
    return entry
      ? { name: this.name(entry.nameOffset), offset: address - entry.address }
      : undefined;
  }
}
