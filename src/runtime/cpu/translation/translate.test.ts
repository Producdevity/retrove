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
  test("thumb strd may store the same register twice", async () => {
    // strd r0, r0, [r1]; ldr r0, [r1, #4]; bx lr
    const words = [0x0000e9c1, 0x47706848];
    expect((await run(words, true, 0x1234, 0x8000)).r0).toBe(0x1234);
  });
  test.each([
    // vmov d0, r0, r0; vmov d1, r1, r1; vcgt.u32 d0, d0, d1; vmov r0, r1, d0
    ["vcgt.u32", [0xec400b10, 0xec411b11, 0xf3200301, 0xec510b10], 0xffffffff, 3, 0xffffffff],
    // vmov d0, r0, r0; vmvn d0, d0; vmov r0, r1, d0
    ["vmvn", [0xec400b10, 0xf3b00580, 0xec510b10], 0x0f0f0f0f, 0, 0xf0f0f0f0],
    // vmov d0, r0, r0; vshl.i32 d0, d0, #4; vmov r0, r1, d0
    ["vshl.i32", [0xec400b10, 0xf2a40510, 0xec510b10], 0x10000001, 0, 0x10],
    // vmov d2, r0, r1; vmov d3, r0, r1; vqmovn.s32 d0, q1; vmov r0, r1, d0
    ["vqmovn.s32", [0xec410b12, 0xec410b13, 0xf3b60282, 0xec510b10], 0x12345, -0x20000, 0x80007fff],
    // vmov d0, r0, r0; vclt.s32 d0, d0, #0; vmov r0, r1, d0
    ["vclt.s32 #0", [0xec400b10, 0xf3b90200, 0xec510b10], -2, 0, 0xffffffff],
    // vmov d2, r0, r1; vmov d3, r0, r1; vmovn.i16 d0, q1; vmov r0, r1, d0
    [
      "vmovn.i16",
      [0xec410b12, 0xec410b13, 0xf3b20202, 0xec510b10],
      0x12345678,
      0xaabbccdd,
      0xbbdd3478,
    ],
    // vmov d2, r0, r1; vmov d3, r0, r1; vqmovun.s16 d0, q1; vmov r0, r1, d0
    [
      "vqmovun.s16",
      [0xec410b12, 0xec410b13, 0xf3b20242, 0xec510b10],
      0x0100ff80,
      0x007f0005,
      0x7f05ff00,
    ],
    // vmov d0, r0, r0; vcvt.s32.f32 d0, d0, #16; vmov r0, r1, d0
    ["vcvt.s32.f32 #16", [0xec400b10, 0xf2b00f10, 0xec510b10], 0x3fc00000, 0, 0x18000],
    // vmov d1, r0, r0; vmov d2, r1, r1; vadd.i16 d0, d1, d2; vmov r0, r1, d0
    ["vadd.i16", [0xec400b11, 0xec411b12, 0xf2110802, 0xec510b10], 0xffff0001, 0x10001, 2],
    // vmov d0, r0, r0; vmov d1, r0, r0; vmov d2, r1, r1; vmla.i16 d0, d1, d2; vmov r0, r1, d0
    [
      "vmla.i16",
      [0xec400b10, 0xec400b11, 0xec411b12, 0xf2110902, 0xec510b10],
      0x30002,
      0x50004,
      0x12000a,
    ],
    // vmov d1, r0, r0; vshr.u16 d0, d1, #1; vmov r0, r1, d0
    ["vshr.u16", [0xec400b11, 0xf39f0011, 0xec510b10], 0x80000002, 0, 0x40000001],
    // vmov d1, r0, r0; vshl.i16 d0, d1, #1; vmov r0, r1, d0
    ["vshl.i16", [0xec400b11, 0xf2910511, 0xec510b10], 0x80010001, 0, 0x20002],
    // vmov d0, r1, r1; vmov d1, r0, r0; vsra.s32 d0, d1, #16; vmov r0, r1, d0
    ["vsra.s32", [0xec411b10, 0xec400b11, 0xf2b00111, 0xec510b10], 0xfffe0000, 10, 8],
    // vmov d1, r0, r1; vshl.i64 d0, d1, #32; vmov r1, r0, d0
    ["vshl.i64", [0xec410b11, 0xf2a00591, 0xec501b10], 0x1234, 0, 0x1234],
    // vmov d1, r0, r1; vmov d2, r1, r1; vshl.u64 d0, d1, d2 (by -4); vmov r0, r1, d0
    ["vshl.u64", [0xec410b11, 0xec411b12, 0xf3320401, 0xec510b10], 0x100, 0xfc, 0xc0000010],
    // vmov d2, r0, r1; vmov d3, r0, r1; vshrn.i32 d0, q1, #16; vmov r0, r1, d0
    [
      "vshrn.i32",
      [0xec410b12, 0xec410b13, 0xf2900812, 0xec510b10],
      0x12345678,
      0xaabbccdd,
      0xaabb1234,
    ],
    // vmov d0, r0, r0; vst1.16 {d0[1]}, [r1]; vld1.16 {d1[0]}, [r1]; vmov r0, r1, d1
    [
      "vld1/vst1.16 lane",
      [0xec400b10, 0xf481044f, 0xf4a1140f, 0xec510b11],
      0x12345678,
      0x8000,
      0x1234,
    ],
    // vmov d1, r0, r1; vmov d2, r1, r0; vsub.i64 d0, d1, d2; vmov r0, r1, d0
    ["vsub.i64", [0xec410b11, 0xec401b12, 0xf3310802, 0xec510b10], 0, 1, 0xffffffff],
    // vmov d2, r0, r1; vmov d3, r0, r1; vmov d4, r0, r1; vaddw.u16 q0, q1, d4; vmov r0, r1, d0
    [
      "vaddw.u16",
      [0xec410b12, 0xec410b13, 0xec410b14, 0xf3920104, 0xec510b10],
      0x10002,
      0,
      0x10004,
    ],
  ])("%s on 32-bit lanes", async (_, words, r0, r1, expected) => {
    expect((await run([...words, 0xe12fff1e], false, r0, r1 >>> 0)).r0).toBe(expected);
  });
  test.each([
    ["pkhbt", [0xe6800811, 0xe12fff1e], false, 0x1111aaaa, 0x0000bbbb, 0xbbbbaaaa],
    ["pkhtb", [0xe6800851, 0xe12fff1e], false, 0x1111aaaa, 0xcccc0000, 0x1111cccc],
    ["thumb pkhbt", [0x4001eac0, 0xbf004770], true, 0x1111aaaa, 0x0000bbbb, 0xbbbbaaaa],
  ])("%s packs halfwords", async (_, words, thumb, r0, r1, expected) => {
    expect((await run(words, thumb, r0, r1)).r0).toBe(expected);
  });
  test("vmsr writes the whole FPSCR that vmrs reads back", async () => {
    // vmsr fpscr, r0; mov r0, #0; vmrs r0, fpscr; bx lr
    const words = [0xeee10a10, 0xe3a00000, 0xeef10a10, 0xe12fff1e];
    expect((await run(words, false, 0xa3000000, 0)).r0).toBe(0xa3000000);
  });
  test("vdup.16 from a core register fills every halfword", async () => {
    // vdup.16 d0, r0; vmov r0, r1, d0; bx lr
    const words = [0xee800b30, 0xec510b10, 0xe12fff1e];
    expect((await run(words, false, 0x1234abcd, 0)).r0).toBe(0xabcdabcd);
  });
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
    expect([...new Bytes().unsigned(624485).values]).toEqual([0xe5, 0x8e, 0x26]);
    expect([...new Bytes().signed(-123456).values]).toEqual([0xc0, 0xbb, 0x78]);
    expect([...new Bytes().signed(0x80000000).values]).toEqual([0x80, 0x80, 0x80, 0x80, 0x78]);
    expect([...new Bytes().signed64(-1n).values]).toEqual([0x7f]);
  });
});
