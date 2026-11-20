import { expect, test } from "vite-plus/test";
import { i32Global } from "./install";
import { StateBytes, StopState, stateLayout, type StateLayout } from "./layout";
import { translate } from "./translate";

const Code = 0x8000;
const LabelBase = 0x420000;
const Memory = { arena: 0, mask: 0xffff } as const;
const Index = { base: 0x410000, start: Code, end: Code + 0x100 } as const;
const States = [0x1000, 0x1000 + StateBytes] as const;
const ReturnAddress = 0x5000;
const Budget = 1000;
const LR = 14;
// add r0, r0, r1; str r0, [r2]; bx lr
const words = [0xe0800001, 0xe5820000, 0xe12fff1e];

function entryPoint(value: unknown): value is (pc: number) => number {
  return typeof value === "function";
}

function setUp(view: DataView, L: StateLayout, r0: number, r1: number, target: number): void {
  for (const [register, value] of [
    [0, r0],
    [1, r1],
    [2, target],
    [LR, ReturnAddress],
  ] as const)
    view.setUint32(L.registers + 4 * register, value, true);
  view.setInt32(L.budget, Budget, true);
}

test("one module instantiated with two state bases keeps each thread's registers apart", () => {
  const [first, second] = States.map((base) => stateLayout(base, Memory, Index));
  if (!first || !second) throw new Error("Missing layout");
  const translation = translate({
    functions: [{ start: Code, end: Code + 4 * words.length }],
    readWord: (address) => words[(address - Code) / 4],
    isCode: (address) => address >= Code && address < Code + 4 * words.length,
    entries: [],
    stopPC: 1,
    layout: first,
    labelAddress: () => 0,
  });
  const [entry] = translation.functions;
  if (!entry) throw new Error("No function");
  const memory = new WebAssembly.Memory({ initial: 128 });
  const table = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
  const compiled = new WebAssembly.Module(translation.wasm);
  const run = [first, second].map((L) => {
    const env = {
      memory,
      table,
      arena: i32Global(Memory.arena),
      labels: i32Global(LabelBase),
      state: i32Global(L.registers),
      host: () => 0,
    };
    const fn = new WebAssembly.Instance(compiled, { env }).exports[entry.exportName];
    if (!entryPoint(fn)) throw new Error("Missing export");
    return fn;
  });
  new Uint8Array(memory.buffer).set(new Uint8Array(entry.labels.buffer), LabelBase);
  const view = new DataView(memory.buffer);
  setUp(view, first, 2, 3, 0x9000);
  setUp(view, second, 40, 2, 0x9004);
  const r0 = (L: StateLayout) => view.getUint32(L.registers, true);

  expect(run[0]?.(entry.start)).toBe(ReturnAddress);
  expect([r0(first), r0(second)]).toEqual([5, 40]);
  expect(view.getInt32(second.budget, true)).toBe(Budget);
  expect(view.getInt32(first.budget, true)).toBeLessThan(Budget);

  expect(run[1]?.(entry.start)).toBe(ReturnAddress);
  expect([r0(first), r0(second)]).toEqual([5, 42]);
  expect([view.getUint32(0x9000, true), view.getUint32(0x9004, true)]).toEqual([5, 42]);
  for (const L of [first, second]) expect(view.getUint32(L.stopped, true)).toBe(StopState.Running);
});
