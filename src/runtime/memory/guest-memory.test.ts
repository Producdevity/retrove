import { expect, test } from "vite-plus/test";
import { Heap, move, read32, readString, write32 } from "./guest-memory";

const memory = () => {
  const bytes = new Uint8Array(0x10000),
    base = 0x10000000,
    maps: number[][] = [];
  const at = (address: number) => (address >= base ? address - base : address);
  return {
    maps,
    read: (address: number, size: number) => bytes.slice(at(address), at(address) + size),
    write: (address: number, data: Uint8Array) => bytes.set(data, at(address)),
    map: (address: number, size: number, permissions: number) =>
      maps.push([address, size, permissions]),
  };
};

test("words and strings round-trip through guest memory", () => {
  const cpu = memory();
  write32(cpu, 0x100, 0xdeadbeef);
  expect(read32(cpu, 0x100)).toBe(0xdeadbeef);
  cpu.write(0x200, new TextEncoder().encode("retrove\0"));
  expect(readString(cpu, 0x200)).toBe("retrove");
});

test("overlapping moves copy backward", () => {
  const cpu = memory();
  cpu.write(0x300, Uint8Array.of(1, 2, 3, 4));
  move(cpu, 0x302, 0x300, 4);
  expect([...cpu.read(0x300, 6)]).toEqual([1, 2, 1, 2, 3, 4]);
});

test("the heap maps pages on growth and reuses coalesced free blocks", () => {
  const cpu = memory(),
    heap = new Heap(cpu);
  const first = heap.alloc(512),
    second = heap.alloc(512),
    third = heap.alloc(512);
  expect(cpu.maps).toEqual([[0x10000000, 4096, 3]]);
  heap.free(first);
  heap.free(second);
  expect(heap.alloc(1024)).toBe(first);
  expect(heap.live.size).toBe(2);
  expect(() => heap.free(third + 4)).toThrow("Invalid guest free");
});

test("the heap hands freed small blocks back to allocations of the same size", () => {
  const heap = new Heap(memory());
  const first = heap.alloc(24),
    second = heap.alloc(24);
  heap.free(first);
  heap.free(second);
  expect(heap.alloc(20)).toBe(second);
  expect(heap.alloc(32)).toBe(first);
  expect(heap.alloc(64, 64) % 64).toBe(0);
});
