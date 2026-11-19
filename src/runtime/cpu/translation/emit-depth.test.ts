import { i32Global } from "./install";
import { expect, test } from "vite-plus/test";
import { MaxCallDepth } from "./emit-depth";
import { StopState, stateLayout } from "./layout";
import { translate } from "./translate";

const Code = 0x1000;
const layout = stateLayout(
  0x1000,
  { arena: 0, mask: 0xffff },
  { base: 0x410000, start: Code, end: Code + 0x100 },
);
// A: add r0, r0, #1; b B    B: add r0, r0, #1; b A
const words = [0xe2800001, 0xeaffffff, 0xe2800001, 0xeafffffb];

function entryPoint(value: unknown): value is (pc: number) => number {
  return typeof value === "function";
}

test("jumps between translated functions unwind at the call depth limit", async () => {
  const translation = translate({
    functions: [
      { start: Code, end: Code + 8 },
      { start: Code + 8, end: Code + 16 },
    ],
    readWord: (address) => words[(address - Code) / 4],
    isCode: (address) => address >= Code && address < Code + 16,
    entries: [],
    stopPC: 1,
    layout,
    labelAddress: (range) => 0x420000 + 0x100 * (range.start - Code),
  });
  const memory = new WebAssembly.Memory({ initial: 128 });
  const table = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
  const { instance } = await WebAssembly.instantiate(translation.wasm, {
    env: {
      memory,
      table,
      arena: i32Global(0),
      labels: i32Global(0),
      state: i32Global(layout.registers),
    },
  });
  for (const translated of translation.functions)
    new Uint8Array(memory.buffer).set(
      new Uint8Array(translated.labels.buffer),
      translated.labelAddress,
    );
  const view = new DataView(memory.buffer);
  view.setInt32(layout.budget, 0x7fffffff, true);
  const first = instance.exports["f1000"];
  if (!entryPoint(first)) throw new Error("Missing export");
  const pc = first(Code) >>> 0;
  expect(pc).toBe(Code + 8);
  expect(view.getUint32(layout.stopped, true)).toBe(StopState.Unwind);
  expect(view.getUint32(layout.registers, true)).toBe(MaxCallDepth + 1);
  expect(view.getUint32(layout.depth, true)).toBe(0);
});
