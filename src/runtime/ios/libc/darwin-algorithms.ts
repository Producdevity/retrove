import { move, type GuestMemory } from "../../memory/guest-memory";
import { ADDRESS_SPACE, type GuestImport } from "./guest-imports";
import { randomImports } from "./random";
import { secureRandomImports } from "./secure-random";

const MULTIPLIER = 16807;
const MODULUS = 2147483647;
const ZERO_SEED_REPLACEMENT = 123459876;
const HEAP_ARITY = 2;
const MINIMUM_SORT_COUNT = 2;
const PATTERN_BYTES = 16;
const PATTERN_CHUNK = 65536;
const Sort = { Base: 0, Count: 1, Width: 2, Compare: 3 } as const;
const Search = { Key: 0, Base: 1, Count: 2, Width: 3, Compare: 4 } as const;
const Pattern = { Destination: 0, Source: 1, Length: 2 } as const;

type CallGuest = (target: number, args: number[]) => Promise<number>;

async function heapSort(
  cpu: GuestMemory,
  callGuest: CallGuest,
  base: number,
  count: number,
  width: number,
  compare: number,
): Promise<void> {
  const ptr = (index: number): number => base + index * width;
  const before = async (left: number, right: number): Promise<number> =>
    (await callGuest(compare, [ptr(left), ptr(right)])) | 0;
  function swap(left: number, right: number): void {
    const bytes = cpu.read(ptr(left), width).slice();
    move(cpu, ptr(left), ptr(right), width);
    cpu.write(ptr(right), bytes);
  }
  async function down(start: number, end: number): Promise<void> {
    let root = start;
    for (let child = root * HEAP_ARITY + 1; child < end; child = root * HEAP_ARITY + 1) {
      if (child + 1 < end && (await before(child, child + 1)) < 0) child++;
      if ((await before(root, child)) >= 0) break;
      swap(root, child);
      root = child;
    }
  }
  for (let start = Math.floor(count / HEAP_ARITY) - 1; start >= 0; start--)
    await down(start, count);
  for (let end = count - 1; end > 0; end--) {
    swap(0, end);
    await down(0, end);
  }
}

export function darwinAlgorithms(
  cpu: GuestMemory,
  callGuest: CallGuest,
): Record<string, GuestImport> {
  let seed = 1;
  return {
    ...randomImports(),
    ...secureRandomImports({ write: (pointer, bytes) => cpu.write(pointer, bytes) }),
    _bsearch: async (a) => {
      const key = a(Search.Key),
        base = a(Search.Base),
        count = a(Search.Count),
        width = a(Search.Width),
        compare = a(Search.Compare);
      if (!width) return 0;
      if (base + count * width > ADDRESS_SPACE)
        throw new Error("Guest bsearch array size overflows its address space");
      let low = 0,
        high = count;
      while (low < high) {
        const mid = Math.floor((high + low) / HEAP_ARITY),
          ptr = base + mid * width;
        const result = (await callGuest(compare, [key, ptr])) | 0;
        if (!result) return ptr;
        if (result > 0) low = mid + 1;
        else high = mid;
      }
      return 0;
    },
    _qsort: async (a) => {
      const base = a(Sort.Base),
        count = a(Sort.Count),
        width = a(Sort.Width),
        compare = a(Sort.Compare);
      if (count < MINIMUM_SORT_COUNT || !width) return;
      if (base + count * width > ADDRESS_SPACE)
        throw new Error("Guest qsort array size overflows its address space");
      await heapSort(cpu, callGuest, base, count, width, compare);
    },
    _srand: (a) => {
      seed = a(0);
    },
    _rand: () => {
      seed = ((seed || ZERO_SEED_REPLACEMENT) * MULTIPLIER) % MODULUS;
      return seed;
    },
    _memset_pattern16: (a) => {
      const address = a(Pattern.Destination),
        length = a(Pattern.Length);
      if (!length) return;
      const pattern = cpu.read(a(Pattern.Source), PATTERN_BYTES).slice(),
        buffer = new Uint8Array(Math.min(PATTERN_CHUNK, length));
      for (let i = 0; i < buffer.length; i += PATTERN_BYTES)
        buffer.set(pattern.subarray(0, Math.min(PATTERN_BYTES, buffer.length - i)), i);
      for (let i = 0; i < length; i += buffer.length)
        cpu.write(address + i, buffer.subarray(0, Math.min(buffer.length, length - i)));
    },
  };
}
