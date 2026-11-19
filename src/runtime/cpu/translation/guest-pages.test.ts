import { describe, expect, it } from "vite-plus/test";
import { GuestPages } from "./guest-pages";
import { ForeignPages } from "./foreign-pages";

function heap() {
  const memory = new WebAssembly.Memory({ initial: 160 });
  let next = 64;
  const freed: number[] = [];
  return {
    memory,
    freed,
    module: {
      get HEAPU8() {
        return new Uint8Array(memory.buffer);
      },
      _malloc(bytes: number) {
        const address = next;
        next += bytes;
        return address;
      },
      _free(address: number) {
        freed.push(address);
      },
    },
  };
}

describe("guest pages", () => {
  it("maps into one arena, reads across pages, refuses unmapped pages and zeroes released ones", () => {
    const { memory, module, freed } = heap();
    const pages = new GuestPages(module, memory, 0x40000);
    pages.map(0x10000, 0x2000);
    expect(pages.word(0x10000)).toBe(0);
    expect(pages.write(0x10ffe, new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(pages.word(0x10ffc)).toBe(0x02010000);
    const bytes = new Uint8Array(4);
    expect(pages.read(0x10ffe, bytes)).toBe(true);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(pages.word(0x12000)).toBeUndefined();
    expect(pages.write(0x11ffe, new Uint8Array(4))).toBe(false);
    pages.unmap(0x10000, 0x2000);
    expect(pages.mapped(0x10000)).toBe(false);
    pages.map(0x10000, 0x2000);
    expect(pages.word(0x10ffc)).toBe(0);
    expect(() => pages.map(0x40000, 0x1000)).toThrow(/outside/);
    pages.close();
    expect(freed).toHaveLength(1);
  });
  it("probes foreign pages with tombstones", () => {
    const { memory, module } = heap();
    const view = new DataView(memory.buffer);
    const foreign = new ForeignPages(module._malloc(ForeignPages.bytes), () => view);
    expect(foreign.set(5, 7)).toBe(true);
    expect(foreign.set(5 + 1024, 9)).toBe(true);
    expect(foreign.entry(5)).toBe(8);
    expect(foreign.remove(5)).toBe(true);
    expect(foreign.entry(5)).toBe(0);
    expect(foreign.entry(5 + 1024)).toBe(10);
  });
});
