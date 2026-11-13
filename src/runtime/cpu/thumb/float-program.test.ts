import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { compileFloatKernel } from "../wasm/float-kernel";
import { planFloatProgram } from "./float-program";
import type { FloatProgram } from "./float-program";
import { decodeAddress } from "./decode-address";
import { decodeFloat } from "./decode-float";
function code(...halves: number[]): Uint8Array {
  const bytes = new Uint8Array(halves.length * 2),
    view = new DataView(bytes.buffer);
  halves.forEach((half, index) => view.setUint16(index * 2, half, true));
  return bytes;
}
const instructions = code(
  0xed90,
  0x0b00,
  0xed91,
  0x1b00,
  0xef40,
  0x0d01,
  0xff40,
  0x1d90,
  0xedc2,
  0x1b00,
  0xef61,
  0x2111,
  0xedc2,
  0x2b02,
  0xedcd,
  0x1b00,
  0xed9d,
  0x2b00,
  0xef22,
  0x3d00,
  0xed82,
  0x3a04,
  0xedd0,
  0x0a02,
  0xedc2,
  0x0a05,
);
const program: FloatProgram = {
  address: 0x1000,
  code: instructions,
  registers: new Map([
    [0, 0x2000],
    [1, 0x2010],
    [2, 0x2020],
    [13, 0x3000],
  ]),
  pointers: new Map(),
  regions: [
    { address: 0x2000, offset: 0, bytes: 16, writable: false },
    { address: 0x2010, offset: 16, bytes: 16, writable: false },
    { address: 0x2020, offset: 32, bytes: 32, writable: true },
  ],
  scratch: { address: 0x3000, bytes: 16 },
};
test("decoded two-lane arithmetic and raw moves match ARM, including spills and odd scalar lanes", async () => {
  const kernel = compileFloatKernel(planFloatProgram(program));
  const buffer = new Uint8Array(kernel.memory.buffer),
    view = new DataView(kernel.memory.buffer);
  const cpu = await createCPU({ budget: "blocks" });
  try {
    cpu.map(0x1000, 0x4000);
    cpu.write(0x1000, instructions);
    cpu.write(0x1000 + instructions.length, code(0x4770));
    const edges = [
      0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000, 0x3f800000, 0xbf800000, 0x7f7fffff,
      0x7f800000, 0xff800000, 0x7f800001, 0xffa00000,
    ];
    for (const left of edges)
      for (const right of edges) {
        buffer.fill(0xa5, 0, 64);
        for (const offset of [0, 4, 8]) view.setUint32(offset, left, true);
        for (const offset of [16, 20]) view.setUint32(offset, right, true);
        cpu.write(0x2000, buffer.subarray(0, 64));
        for (const [register, address] of program.registers) cpu.setReg(register, address);
        cpu.setReg(14, 0x4000);
        expect(cpu.run(0x1001, { until: 0x4000, count: 100 })).toMatchObject({ reason: "until" });
        kernel.run();
        expect(buffer.subarray(0, 64)).toEqual(cpu.read(0x2000, 64));
      }
  } finally {
    cpu.close();
  }
});
test("address decoder handles PC additions, split immediates and rotated immediates", () => {
  expect(decodeAddress(0x44f9)).toEqual({ kind: "add-register", destination: 9, source: 15 });
  expect(decodeAddress(0xac28)).toEqual({
    kind: "add-immediate",
    destination: 4,
    base: 13,
    immediate: 160,
  });
  expect(decodeAddress(0xf246, 0x696e)).toEqual({
    kind: "move-low",
    destination: 9,
    immediate: 0x666e,
  });
  expect(decodeAddress(0xf2c0, 0x19e8)).toEqual({
    kind: "move-high",
    destination: 9,
    immediate: 0x1e8,
  });
  expect(decodeAddress(0xf509, 0x6080)).toEqual({
    kind: "add-immediate",
    destination: 0,
    base: 9,
    immediate: 1024,
  });
  expect(decodeAddress(0xf509, 0x6008)).toEqual({
    kind: "add-immediate",
    destination: 0,
    base: 9,
    immediate: 2176,
  });
  expect(decodeAddress(0xf8d7, 0x9008)).toEqual({
    kind: "load-pointer",
    destination: 9,
    base: 7,
    immediate: 8,
  });
  expect(decodeFloat(0xed10, 0x0a01)).toEqual({
    kind: "load-float",
    base: 0,
    offset: -4,
    lane: 0,
    lanes: 1,
  });
});
test("planner rejects unsupported control flow, undefined outputs and escaping or overlapping memory", () => {
  const invalid: FloatProgram[] = [
    { ...program, code: code(0x4770) },
    { ...program, code: code(0xef40) },
    { ...program, code: code(0xed82, 0x0a00) },
    { ...program, code: code(0xed90, 0x0a00, 0xed80, 0x0a00) },
    { ...program, code: code(0xed90, 0x0a00, 0xed82, 0x0a08) },
    { ...program, code: code(0xed9d, 0x0a00, 0xed82, 0x0a00) },
    { ...program, code: code(0xf8d7, 0x9008) },
    { ...program, code: code(0xef21, 0x0112) },
    { ...program, code: code(0xef40, 0x0d41) },
    { ...program, code: new Uint8Array([0]) },
    { ...program, scratch: { address: 0x2000, bytes: 8 } },
    {
      ...program,
      regions: [...program.regions, { address: 0x5000, offset: 0, bytes: 8, writable: true }],
    },
  ];
  for (const candidate of invalid) expect(() => planFloatProgram(candidate)).toThrow();
});
