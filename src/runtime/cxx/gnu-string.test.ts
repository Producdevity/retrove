import { describe, expect, it } from "vite-plus/test";
import { CowStrings, gnuStringImports } from "./gnu-string";

function setup() {
  const bytes = new Uint8Array(0x10000);
  const view = new DataView(bytes.buffer);
  let next = 0x100;
  const freed: number[] = [];
  const allocate = (size: number) => {
    const pointer = next;
    next += (size + 15) & ~15;
    return pointer;
  };
  const strings = new CowStrings({
    read: (pointer) => view.getUint32(pointer, true),
    write: (pointer, value) => view.setUint32(pointer, value >>> 0, true),
    readBytes: (pointer, length) => bytes.slice(pointer, pointer + length),
    writeBytes: (pointer, data) => bytes.set(data, pointer),
    allocate,
    free: (pointer) => void freed.push(pointer),
    zero: allocate,
    lengthError: () => {
      throw new Error("length_error");
    },
  });
  const imports = gnuStringImports(strings);
  const text = (value: string) => {
    const pointer = allocate(value.length + 1);
    bytes.set(new TextEncoder().encode(value), pointer);
    return pointer;
  };
  const self = allocate(4);
  view.setUint32(self, strings.emptyRep + 12, true);
  const read = (string: number) => {
    const data = view.getUint32(string, true);
    const length = view.getUint32(data - 12, true);
    return new TextDecoder().decode(bytes.slice(data, data + length + 1));
  };
  const call = (name: string, ...values: number[]) => imports[name]?.((i) => values[i] ?? 0);
  return { strings, view, self, text, read, call, freed, allocate };
}

describe("GNU copy-on-write strings", () => {
  it("assigns and appends with a terminator, leaving the empty rep untouched", () => {
    const { strings, view, self, text, read, call } = setup();
    call("__ZNSs6assignEPKcm", self, text("hello"), 5);
    expect(read(self)).toBe("hello\0");
    call("__ZNSs6appendEPKcm", self, text(", world"), 7);
    expect(read(self)).toBe("hello, world\0");
    expect(view.getUint32(strings.emptyRep, true)).toBe(0);
  });
  it("unshares a shared rep before writing and drops one reference", () => {
    const { view, self, text, read, call, allocate } = setup();
    call("__ZNSs6assignEPKcm", self, text("shared"), 6);
    const copy = allocate(4);
    const data = view.getUint32(self, true);
    view.setUint32(copy, data, true);
    view.setUint32(data - 4, 1, true);
    call("__ZNSs6assignEPKcm", self, text("mine"), 4);
    expect(read(self)).toBe("mine\0");
    expect(read(copy)).toBe("shared\0");
    expect(view.getUint32(data - 4, true)).toBe(0);
  });
  it("assigns from its own characters", () => {
    const { view, self, text, read, call } = setup();
    call("__ZNSs6assignEPKcm", self, text("abcdef"), 6);
    call("__ZNSs6assignEPKcm", self, view.getUint32(self, true) + 2, 3);
    expect(read(self)).toBe("cde\0");
  });
});
