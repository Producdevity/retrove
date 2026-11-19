import { afterEach, expect, test, vi } from "vite-plus/test";
import { ExecutionBudget } from "../execution-budget";
import { ArenaHeap, crossOriginIsolation } from "./arena-heap";
import { OwnCpu } from "./own-cpu";

const WASM_PAGE_BYTES = 65_536;
const ARENA = 1 << 20;
/** More pages than a wasm32 memory can declare, as a refused reservation. */
const UNRESERVABLE = 5 * 2 ** 30;
const Guest = { Code: 0x10000, Data: 0x20000, Return: 0x30000, Page: 0x1000 } as const;
/** 1: ldrex r2, [r1]; add r2, r2, r0; strex r3, r2, [r1]; cmp r3, #0; bne 1b; dmb ish; mov r0, r2; bx lr */
const Increment = [
  0xe1912f9f, 0xe0822000, 0xe1813f92, 0xe3530000, 0x1afffffa, 0xf57ff05b, 0xe1a00002, 0xe12fff1e,
];

afterEach(() => {
  vi.unstubAllGlobals();
});

test("pages that are not cross-origin isolated get an ordinary growable memory", () => {
  expect(crossOriginIsolation()).toBe(false);
  const heap = new ArenaHeap(ARENA);
  expect(heap.shared).toBe(false);
  expect(heap.getTciMemory().buffer).toBeInstanceOf(ArrayBuffer);
  expect(heap._malloc(ARENA)).toBe(WASM_PAGE_BYTES);
  expect(heap.HEAPU8.length).toBe(WASM_PAGE_BYTES + ARENA);
});

test("isolated pages reserve the whole arena as one shared memory", () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const heap = new ArenaHeap(ARENA);
  expect(heap.shared).toBe(true);
  expect(heap.getTciMemory().buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(heap.HEAPU8.length).toBe(WASM_PAGE_BYTES + ARENA);
  expect(heap._malloc(ARENA + WASM_PAGE_BYTES)).toBe(0);
  expect(heap._malloc(ARENA)).toBe(WASM_PAGE_BYTES);
  expect(heap._malloc(ARENA)).toBe(0);
});

test("a refused shared reservation falls back to the unshared memory", () => {
  const heap = new ArenaHeap(UNRESERVABLE, true);
  expect(heap.shared).toBe(false);
  expect(heap.getTciMemory().buffer).toBeInstanceOf(ArrayBuffer);
});

function words(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(4 * values.length),
    view = new DataView(bytes.buffer);
  values.forEach((value, k) => view.setUint32(4 * k, value, true));
  return bytes;
}

test.each([false, true])(
  "the own CPU runs exclusives and host atomics on its memory (isolated: %s)",
  (isolated) => {
    vi.stubGlobal("crossOriginIsolated", isolated);
    const cpu = new OwnCpu(ExecutionBudget.Blocks);
    try {
      expect(cpu.sharedMemory).toBe(isolated);
      cpu.map(Guest.Code, Guest.Page, 5);
      cpu.map(Guest.Data, Guest.Page, 3);
      cpu.write(Guest.Code, words(Increment));
      cpu.write(Guest.Data, words([10]));
      cpu.setReg(0, 5);
      cpu.setReg(1, Guest.Data);
      cpu.setReg(14, Guest.Return);
      expect(cpu.run(Guest.Code, { until: Guest.Return }).reason).toBe("until");
      expect([cpu.getReg(0), cpu.read32(Guest.Data)]).toEqual([15, 15]);
      const atomics = cpu.atomics;
      expect(atomics.compareExchange32(Guest.Data, 15, 0xffff_fff0)).toBe(15);
      expect(atomics.compareExchange32(Guest.Data, 15, 1)).toBe(0xffff_fff0);
      expect(atomics.add32(Guest.Data, 0x20)).toBe(0xffff_fff0);
      atomics.store32(Guest.Data + 4, 7);
      expect([cpu.read32(Guest.Data), cpu.read32(Guest.Data + 4)]).toEqual([0x10, 7]);
      expect(() => atomics.add32(Guest.Data + 2, 1)).toThrow(RangeError);
    } finally {
      cpu.close();
    }
  },
);
