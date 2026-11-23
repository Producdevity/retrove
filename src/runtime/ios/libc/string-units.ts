import { fill, move, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { ADDRESS_SPACE } from "./guest-imports";
import { asciiLower } from "./rune-locale";

const PAGE = 4096;
const CHUNK_BYTES = 256;
export const Width = { Narrow: 1, Wide: WORD_BYTES } as const;

export interface Scanned {
  n: number;
  found: boolean;
}

export class GuestStrings {
  constructor(private readonly cpu: GuestMemory) {}

  // Read one mapped page at a time. A bounded, unterminated string can legally
  // end at the last byte of a page; strlen and wchar_t functions end at NUL.
  *units(address: number, width: number, maximum = Infinity): Generator<number, void> {
    if (width === Width.Wide && address % WORD_BYTES) throw new Error("Unaligned wchar_t string");
    for (let count = 0; count < maximum;) {
      const at = address + count * width;
      if (at >= ADDRESS_SPACE) throw new Error("Unterminated guest string");
      const size = Math.min(CHUNK_BYTES, PAGE - (at % PAGE), (maximum - count) * width);
      const bytes = this.cpu.read(at, size);
      const words =
        width === Width.Wide ? new DataView(bytes.buffer, bytes.byteOffset, size) : undefined;
      for (let offset = 0; offset < size; offset += width) {
        yield words ? words.getInt32(offset, true) : (bytes[offset] ?? 0);
        count++;
      }
    }
  }

  length(address: number, width: number, limit?: number): number {
    let n = 0;
    for (const c of this.units(address, width, limit)) {
      if (!c) break;
      n++;
    }
    return n;
  }

  compare(left: number, right: number, width: number, limit: number | undefined, fold: boolean) {
    const other = this.units(right, width, limit);
    for (const c of this.units(left, width, limit)) {
      let d = other.next().value ?? 0;
      const near = fold ? asciiLower(c) : c;
      if (fold) d = asciiLower(d);
      if (near !== d) return near < d ? -1 : 1;
      if (!c) break;
    }
    return 0;
  }

  copy(
    dest: number,
    source: number,
    width: number,
    limit: number | undefined,
    append: boolean,
    checkedSize = Infinity,
  ): number {
    const old = append ? this.length(dest, width) : 0;
    const n = this.length(source, width, limit);
    const write = append || limit === undefined ? n + 1 : limit;
    if (old + write > checkedSize) throw new Error("Guest string copy exceeds destination size");
    const address = dest + old * width;
    if (n) move(this.cpu, address, source, n * width);
    if (write > n) fill(this.cpu, address + n * width, 0, (write - n) * width);
    return dest;
  }

  findChar(address: number, value: number, width: number, last = false, limit?: number): number {
    let previous = 0,
      at = address;
    for (const c of this.units(address, width, limit)) {
      if (c === value) {
        previous = at;
        if (!last) return at;
      }
      if (!c && limit === undefined) break;
      at += width;
    }
    return previous;
  }

  members(address: number, width: number): Set<number> {
    const set = new Set<number>();
    for (const c of this.units(address, width)) {
      if (!c) break;
      set.add(c);
    }
    return set;
  }

  scan(address: number, width: number, set: Set<number>): Scanned {
    let n = 0;
    for (const c of this.units(address, width)) {
      if (!c || set.has(c)) return { n, found: c !== 0 };
      n++;
    }
    return { n, found: false };
  }

  substring(haystack: number, needle: number, width: number): number {
    const pattern: number[] = [];
    for (const c of this.units(needle, width)) {
      if (!c) break;
      pattern.push(c);
    }
    if (!pattern.length) return haystack;
    // KMP also handles repeated prefixes without rescanning the guest memory.
    const prefix = new Uint32Array(pattern.length);
    for (let i = 1, j = 0; i < pattern.length; i++) {
      while (j && pattern[i] !== pattern[j]) j = prefix[j - 1] ?? 0;
      if (pattern[i] === pattern[j]) j++;
      prefix[i] = j;
    }
    let j = 0,
      at = haystack;
    for (const c of this.units(haystack, width)) {
      if (!c) break;
      while (j && c !== pattern[j]) j = prefix[j - 1] ?? 0;
      if (c === pattern[j] && ++j === pattern.length) return at - (j - 1) * width;
      at += width;
    }
    return 0;
  }
}
