import type { GuestArguments } from "../objc/host";
import { GuestLayout } from "../../memory/guest-layout";
import { write32, type GuestMemory } from "../../memory/guest-memory";

const PAGE = 4096;
const LOW: number = GuestLayout.MappingLow;
const HIGH: number = GuestLayout.MappingHigh;
const MapFlag = { Shared: 1, Private: 2, Fixed: 0x10, Anonymous: 0x1000 } as const;
const MAP_TYPE_MASK = 3;
const MAP_TYPES: readonly number[] = [MapFlag.Private, MapFlag.Shared];
const MAP_FLAG_MASK = 0x1253;
const PROTECTION_MASK = 7;
const MAP_FAILED = 0xffff_ffff;
const Errno = { NoMemory: 12, NoDevice: 19, Invalid: 22 } as const;
const Argument = {
  Address: 0,
  Length: 1,
  Protection: 2,
  Flags: 3,
  Offset: 5,
  Descriptor: 6,
} as const;
const pageUp = (n: number): number => Math.ceil(n / PAGE) * PAGE;

interface Area {
  readonly start: number;
  readonly end: number;
}
export interface VirtualMemoryCpu extends GuestMemory {
  map(address: number, size: number, permissions: number): void;
  unmap(address: number, size: number): void;
}

export function virtualMemoryImports(
  cpu: VirtualMemoryCpu,
  errno: number,
): Record<"_mmap" | "_munmap", (a: GuestArguments) => number> {
  let areas: Area[] = []; // Sorted, disjoint half-open anonymous mappings.
  function fail(code: number): number {
    write32(cpu, errno, code);
    return MAP_FAILED;
  }
  function gap(from: number, size: number): number {
    let start = Math.max(LOW, from);
    for (const area of areas) {
      if (area.end <= start) continue;
      if (area.start - start >= size) break;
      start = area.end;
    }
    return start + size <= HIGH ? start : 0;
  }
  function unmap(start: number, end: number): void {
    const remaining: Area[] = [];
    for (const area of areas) {
      const left = Math.max(area.start, start),
        right = Math.min(area.end, end);
      if (left >= right) {
        remaining.push(area);
        continue;
      }
      cpu.unmap(left, right - left);
      if (area.start < left) remaining.push({ start: area.start, end: left });
      if (right < area.end) remaining.push({ start: right, end: area.end });
    }
    areas = remaining;
  }
  return {
    _mmap: (a) => {
      const address = a(Argument.Address),
        size = pageUp(a(Argument.Length)),
        perms = a(Argument.Protection),
        flags = a(Argument.Flags);
      if (
        !size ||
        perms & ~PROTECTION_MASK ||
        flags & ~MAP_FLAG_MASK ||
        !MAP_TYPES.includes(flags & MAP_TYPE_MASK) ||
        a(Argument.Offset) & (PAGE - 1) ||
        (a(Argument.Descriptor) | 0) < 0
      )
        return fail(Errno.Invalid);
      if (!(flags & MapFlag.Anonymous)) return fail(Errno.NoDevice); // The device has no file mapping support.
      let start: number;
      if (flags & MapFlag.Fixed) {
        if (address % PAGE || address < LOW || address + size > HIGH) return fail(Errno.Invalid);
        start = address;
        unmap(start, start + size);
      } else start = gap(pageUp(address), size) || gap(LOW, size);
      if (!start) return fail(Errno.NoMemory);
      try {
        cpu.map(start, size, perms);
      } catch (error) {
        if (error instanceof WebAssembly.RuntimeError) throw error;
        return fail(Errno.NoMemory);
      }
      const i = areas.findIndex((area) => area.start > start);
      areas.splice(i < 0 ? areas.length : i, 0, { start, end: start + size });
      return start;
    },
    _munmap: (a) => {
      const start = a(Argument.Address),
        size = pageUp(a(Argument.Length));
      if (!size || start % PAGE || start < LOW || start + size > HIGH) return fail(Errno.Invalid);
      unmap(start, start + size);
      return 0;
    },
  };
}
