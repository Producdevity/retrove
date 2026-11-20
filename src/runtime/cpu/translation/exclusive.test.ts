import { describe, expect, test } from "vite-plus/test";
import { i32Global } from "./install";
import { StateBytes, StopState, stateLayout, type StateLayout } from "./layout";
import { translate } from "./translate";

const Code = 0x8000;
const LabelBase = 0x420000;
const ReturnAddress = 0x5000;
const Budget = 1000;
const LR = 14;
const Data = 0x9000;
const Pages = 128;
const Memory = { arena: 0, mask: 0xffff } as const;
const States = [0x1000, 0x1000 + StateBytes] as const;
const Return = 0xe12fff1e;
/** One instruction followed by `bx lr` per function, so each can run on its own. */
const Single = {
  ldrex: 0xe1910f9f, // ldrex r0, [r1]
  strex: 0xe1810f92, // strex r0, r2, [r1]
  clrex: 0xf57ff01f,
  ldrexd: 0xe1b12f9f, // ldrexd r2, r3, [r1]
  strexd: 0xe1a10f92, // strexd r0, r2, r3, [r1]
  ldrexb: 0xe1d10f9f, // ldrexb r0, [r1]
  strexb: 0xe1c10f92, // strexb r0, r2, [r1]
  ldrexh: 0xe1f10f9f, // ldrexh r0, [r1]
  strexh: 0xe1e10f92, // strexh r0, r2, [r1]
} as const;
type Name = keyof typeof Single | "increment";
/** 1: ldrex r2, [r1]; add r2, r2, r0; strex r3, r2, [r1]; cmp r3, #0; bne 1b; dmb ish; mov r0, r2; bx lr */
const Increment = [
  0xe1912f9f,
  0xe0822000,
  0xe1813f92,
  0xe3530000,
  0x1afffffa,
  0xf57ff05b,
  0xe1a00002,
  Return,
];
const names = Object.keys(Single).filter((name): name is keyof typeof Single => name in Single);
const words = [...names.flatMap((name) => [Single[name], Return]), ...Increment];
const starts = new Map<Name, number>([
  ...names.map((name, k): [Name, number] => [name, Code + 8 * k]),
  ["increment", Code + 8 * names.length],
]);

function entryPoint(value: unknown): value is (pc: number) => number {
  return typeof value === "function";
}

/** Two guest threads (state blocks) running one translated module over the same memory. */
function machine(shared: boolean) {
  const [first, second] = States.map((base) =>
    stateLayout(base, Memory, { base: 0x410000, start: Code, end: Code + 0x100 }),
  );
  if (!first || !second) throw new Error("Missing layout");
  const ranges = [...starts.values()].map((start, k, all) => ({
    start,
    end: all[k + 1] ?? Code + 4 * words.length,
  }));
  const translation = translate({
    functions: ranges,
    readWord: (address) => words[(address - Code) / 4],
    isCode: (address) => address >= Code && address < Code + 4 * words.length,
    entries: [],
    stopPC: 1,
    layout: first,
    labelAddress: (range) => 2 * (range.start - Code),
    shared,
  });
  const memory = new WebAssembly.Memory({ initial: Pages, maximum: Pages, shared });
  const table = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
  const compiled = new WebAssembly.Module(translation.wasm);
  const bytes = new Uint8Array(memory.buffer),
    view = new DataView(memory.buffer);
  for (const f of translation.functions)
    bytes.set(new Uint8Array(f.labels.buffer), LabelBase + f.labelAddress);
  const thread = (L: StateLayout) => {
    const env = {
      memory,
      table,
      arena: i32Global(Memory.arena),
      labels: i32Global(LabelBase),
      state: i32Global(L.registers),
      host: () => 0,
    };
    const exports = new WebAssembly.Instance(compiled, { env }).exports;
    const register = (n: number) => view.getUint32(L.registers + 4 * n, true);
    return {
      register,
      run(name: Name, registers: Readonly<Record<number, number>>): number {
        const f = translation.functions.find((entry) => entry.start === starts.get(name));
        const fn = f && exports[f.exportName];
        if (!f || !entryPoint(fn)) throw new Error("Missing export " + name);
        for (const [n, value] of Object.entries(registers))
          view.setUint32(L.registers + 4 * Number(n), value, true);
        view.setUint32(L.registers + 4 * LR, ReturnAddress, true);
        view.setInt32(L.budget, Budget, true);
        expect(fn(f.start)).toBe(ReturnAddress);
        expect(view.getUint32(L.stopped, true)).toBe(StopState.Running);
        return register(0);
      },
    };
  };
  return { a: thread(first), b: thread(second), view, wasm: translation.wasm };
}

describe("exclusives on shared memory", () => {
  test("an LDREX/STREX increment loop on two threads adds every delta", () => {
    const { a, b, view } = machine(true);
    view.setUint32(Data, 10, true);
    for (let k = 0; k < 50; k++) {
      expect(a.run("increment", { 0: 3, 1: Data })).toBe(view.getUint32(Data, true));
      b.run("increment", { 0: 2, 1: Data });
    }
    expect(view.getUint32(Data, true)).toBe(10 + 50 * 5);
  });
  test("STREX succeeds with 0 and fails with 1 once another thread changed the word", () => {
    const { a, b, view } = machine(true);
    view.setUint32(Data, 15, true);
    expect(a.run("ldrex", { 1: Data })).toBe(15);
    expect(b.run("ldrex", { 1: Data })).toBe(15);
    expect(b.run("strex", { 1: Data, 2: 99 })).toBe(0);
    expect(a.run("strex", { 1: Data, 2: 7 })).toBe(1);
    expect(view.getUint32(Data, true)).toBe(99);
    expect(a.run("ldrex", { 1: Data })).toBe(99);
    expect(a.run("strex", { 1: Data, 2: 7 })).toBe(0);
    expect(view.getUint32(Data, true)).toBe(7);
    expect(a.run("strex", { 1: Data, 2: 8 })).toBe(1);
  });
  test("a host write, CLREX or another address leaves the store unperformed", () => {
    const { a, view } = machine(true);
    view.setUint32(Data, 1, true);
    a.run("ldrex", { 1: Data });
    view.setUint32(Data, 2, true);
    expect(a.run("strex", { 1: Data, 2: 3 })).toBe(1);
    a.run("ldrex", { 1: Data });
    a.run("clrex", {});
    expect(a.run("strex", { 1: Data, 2: 3 })).toBe(1);
    a.run("ldrex", { 1: Data });
    expect(a.run("strex", { 1: Data + 4, 2: 3 })).toBe(1);
    expect([view.getUint32(Data, true), view.getUint32(Data + 4, true)]).toEqual([2, 0]);
  });
  test("byte and halfword exclusives swap only their own bytes", () => {
    const { a, b, view } = machine(true);
    view.setUint32(Data, 0x44332211, true);
    expect(a.run("ldrexb", { 1: Data + 1 })).toBe(0x22);
    expect(a.run("strexb", { 1: Data + 1, 2: 0x1ff })).toBe(0);
    expect(view.getUint32(Data, true)).toBe(0x4433ff11);
    expect(a.run("ldrexh", { 1: Data + 2 })).toBe(0x4433);
    b.run("ldrexh", { 1: Data + 2 });
    expect(b.run("strexh", { 1: Data + 2, 2: 0xbeef })).toBe(0);
    expect(a.run("strexh", { 1: Data + 2, 2: 0xcafe })).toBe(1);
    expect(view.getUint32(Data, true)).toBe(0xbeefff11);
  });
  test("doubleword exclusives compare and swap all 64 bits", () => {
    const { a, b, view } = machine(true);
    view.setBigUint64(Data, 0x1111_2222_3333_4444n, true);
    a.run("ldrexd", { 1: Data });
    expect([a.register(2), a.register(3)]).toEqual([0x3333_4444, 0x1111_2222]);
    b.run("ldrexd", { 1: Data });
    view.setUint32(Data + 4, 0x5555_6666, true);
    expect(b.run("strexd", { 1: Data, 2: 1, 3: 2 })).toBe(1);
    expect(a.run("strexd", { 1: Data, 2: 1, 3: 2 })).toBe(1);
    a.run("ldrexd", { 1: Data });
    expect(a.run("strexd", { 1: Data, 2: 0xaaaa_bbbb, 3: 0xcccc_dddd })).toBe(0);
    expect(view.getBigUint64(Data, true)).toBe(0xcccc_dddd_aaaa_bbbbn);
  });
});

describe("exclusives on unshared memory", () => {
  test("stores always succeed, as on the single-core translation", () => {
    const { a, b, view } = machine(false);
    view.setUint32(Data, 0x44332211, true);
    a.run("ldrex", { 1: Data });
    view.setUint32(Data, 5, true);
    expect(a.run("strex", { 1: Data, 2: 6 })).toBe(0);
    expect(b.run("ldrexb", { 1: Data })).toBe(6);
    expect(b.run("strexh", { 1: Data + 2, 2: 0x7788 })).toBe(0);
    view.setBigUint64(Data + 8, 0x0102_0304_0506_0708n, true);
    b.run("ldrexd", { 1: Data + 8 });
    expect([b.register(2), b.register(3)]).toEqual([0x0506_0708, 0x0102_0304]);
    expect(b.run("strexd", { 1: Data + 8, 2: 9, 3: 10 })).toBe(0);
    expect(view.getBigUint64(Data + 8, true)).toBe(0x0000_000a_0000_0009n);
    expect(view.getUint32(Data, true)).toBe(0x7788_0006);
  });
  test("a module only instantiates against the memory kind it was emitted for", () => {
    for (const shared of [false, true]) {
      const module = new WebAssembly.Module(machine(shared).wasm);
      const memory = new WebAssembly.Memory({ initial: Pages, maximum: Pages, shared: !shared });
      const env = {
        memory,
        table: new WebAssembly.Table({ element: "anyfunc", initial: 1 }),
        arena: i32Global(0),
        labels: i32Global(0),
        state: i32Global(0),
        host: () => 0,
      };
      expect(() => new WebAssembly.Instance(module, { env })).toThrow();
    }
  });
});
