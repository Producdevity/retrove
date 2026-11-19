import { i32Global } from "./install";
import { describe, expect, test } from "vite-plus/test";
import { Double, Single } from "./emit-constants";
import { StopState, stateLayout } from "./layout";
import { translate, type FunctionRange } from "./translate";
import { Bytes } from "./wasm-bytes";

const Code = 0x1000;
const LabelBase = 0x420000;
const layout = stateLayout(
  0x1000,
  { arena: 0, mask: 0xffff },
  { base: 0x410000, start: Code, end: Code + 0x100 },
);

function translateWords(words: readonly number[], thumb: boolean) {
  const bytes = new DataView(new ArrayBuffer(4 * words.length));
  words.forEach((word, k) => bytes.setUint32(4 * k, word, true));
  const range: FunctionRange = { start: Code | (thumb ? 1 : 0), end: Code + 4 * words.length };
  return translate({
    functions: [range],
    readWord: (address) =>
      address >= Code && address + 4 <= range.end
        ? bytes.getUint32(address - Code, true)
        : undefined,
    isCode: (address) => address >= Code && address < range.end,
    entries: [],
    stopPC: 1,
    layout,
    labelAddress: () => LabelBase,
  });
}

function entryPoint(value: unknown): value is (pc: number) => number {
  return typeof value === "function";
}

/** Runs the single translated function with r0, r1 and LR set; returns the exit PC, registers and NZCV. */
async function run(words: readonly number[], thumb: boolean, r0: number, r1: number) {
  const translation = translateWords(words, thumb);
  const memory = new WebAssembly.Memory({ initial: 128 });
  const table = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
  const { instance } = await WebAssembly.instantiate(translation.wasm, {
    env: { memory, table, arena: i32Global(0), labels: i32Global(0) },
  });
  const view = new DataView(memory.buffer);
  const [entry] = translation.functions;
  if (!entry) throw new Error("No function");
  new Uint8Array(memory.buffer).set(new Uint8Array(entry.labels.buffer), entry.labelAddress);
  view.setUint32(layout.registers, r0, true);
  view.setUint32(layout.registers + 4, r1, true);
  view.setUint32(layout.registers + 4 * 14, 0x5000, true);
  view.setInt32(layout.budget, 0x7fffffff, true);
  const fn = instance.exports[entry.exportName];
  if (!entryPoint(fn)) throw new Error("Missing export");
  const pc = fn(entry.start) >>> 0;
  const flags = [0, 1, 2, 3].map((k) => view.getUint32(layout.flags + 4 * k, true));
  return {
    pc,
    r0: view.getUint32(layout.registers, true),
    flags,
    stopped: view.getUint32(layout.stopped, true),
  };
}

describe("translate", () => {
  test.each([
    ["vmla", 0xee011a20, 0x41000000],
    ["vmls", 0xee011a60, 0xc0800000],
    ["vnmls", 0xee111a20, 0x40800000],
    ["vnmla", 0xee111a60, 0xc1000000],
  ])("%s.f32 accumulates the rounded product into the destination", async (_, op, expected) => {
    // vmov s0, r0; vmov s1, r1; vmov s2, r0; <op> s2, s0, s1; vmov r0, s2; bx lr
    const words = [0xee000a10, 0xee001a90, 0xee010a10, op, 0xee110a10, 0xe12fff1e];
    const result = await run(words, false, 0x40000000, 0x40400000);
    expect([result.pc, result.r0]).toEqual([0x5000, expected]);
  });
  test("emits a valid module for an ARM function", () => {
    const translation = translateWords([0xe0800001, 0xe12fff1e], false);
    expect(WebAssembly.validate(translation.wasm)).toBe(true);
    expect(translation.functions.map((f) => f.exportName)).toEqual(["f1000"]);
    expect(translation.statistics).toEqual({
      functions: 1,
      instructions: 2,
      reachable: 2,
      blocks: 1,
      unsupported: 0,
      unsupportedExecutable: [],
    });
  });

  test("runs ARM and Thumb arithmetic and returns through LR", async () => {
    const arm = await run([0xe0800001, 0xe12fff1e], false, 2, 3);
    expect(arm).toEqual({ pc: 0x5000, r0: 5, flags: [0, 0, 0, 0], stopped: StopState.Running });
    // adds r0, r0, r1; bx lr
    const thumb = await run([0x47701840], true, 0xffffffff, 1);
    expect(thumb).toEqual({ pc: 0x5000, r0: 0, flags: [0, 1, 1, 0], stopped: StopState.Running });
  });

  test("leaves to the interpreter at unsupported instructions", async () => {
    const translation = translateWords([0xe7f000f0], false);
    expect(WebAssembly.validate(translation.wasm)).toBe(true);
    expect(translation.statistics.unsupportedExecutable).toEqual([Code]);
    const result = await run([0xe7f000f0], false, 0, 0);
    expect(result).toMatchObject({ pc: Code, stopped: StopState.Exit });
  });
});

describe("encoding constants", () => {
  test("float thresholds are the smallest normals", () => {
    expect(Single.FlushThreshold).toBe(2 ** -126);
    expect(Double.Minimum).toBe(2 ** -1022);
  });

  test("LEB128 encodes signed and unsigned values", () => {
    expect(new Bytes().unsigned(624485).values).toEqual([0xe5, 0x8e, 0x26]);
    expect(new Bytes().signed(-123456).values).toEqual([0xc0, 0xbb, 0x78]);
    expect(new Bytes().signed(0x80000000).values).toEqual([0x80, 0x80, 0x80, 0x80, 0x78]);
    expect(new Bytes().signed64(-1n).values).toEqual([0x7f]);
  });
});
