import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { planFloatProgram } from "./float-program";
import { compileFloatKernel } from "../../../../src/runtime/cpu/wasm/float-kernel";
import { decodeAddress } from "./decode-address";
const halves = (...values: number[]) => new Uint8Array(Uint16Array.from(values).buffer);
test("pointer chains and multi-load with base in destination list match ARM", async () => {
  const code = halves(
    0x6859,
    0xe891,
    0x0006,
    0xed91,
    0x0a00,
    0xed92,
    0x1a00,
    0xef00,
    0x0d01,
    0xed80,
    0x0a00,
  );
  const registers = new Map([
      [0, 0x2000],
      [3, 0x3000],
    ]),
    pointers = new Map([
      [0x3004, 0x3100],
      [0x3100, 0x2100],
      [0x3104, 0x2200],
    ]);
  const plan = planFloatProgram({
    address: 0x1000,
    code,
    registers,
    pointers,
    regions: [
      { address: 0x2000, offset: 0, bytes: 4, writable: true },
      { address: 0x2100, offset: 4, bytes: 4, writable: false },
      { address: 0x2200, offset: 8, bytes: 4, writable: false },
    ],
    scratch: { address: 0x4000, bytes: 0 },
  });
  const kernel = compileFloatKernel(plan),
    data = new DataView(kernel.memory.buffer);
  data.setFloat32(4, 1.25, true);
  data.setFloat32(8, -3.5, true);
  kernel.run();
  const cpu = await createCPU({ budget: "blocks" });
  try {
    cpu.map(0x1000, 0x4000);
    cpu.write(0x1000, code);
    cpu.write(0x1000 + code.length, halves(0x4770));
    for (const [reg, value] of registers) cpu.setReg(reg, value);
    for (const [address, value] of pointers)
      cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
    cpu.write(0x2100, new Uint8Array(Float32Array.of(1.25).buffer));
    cpu.write(0x2200, new Uint8Array(Float32Array.of(-3.5).buffer));
    cpu.setReg(14, 0x4000);
    expect(cpu.run(0x1001, { until: 0x4000, count: 30 }).reason).toBe("until");
    expect(cpu.read(0x2000, 4)).toEqual(new Uint8Array(kernel.memory.buffer, 0, 4));
  } finally {
    cpu.close();
  }
});
test("unsupported multi-load variants are rejected", () => {
  for (const [first, second] of [
    [0xe89f, 0x0003],
    [0xe891, 0x0002],
    [0xe891, 0x0000],
    [0xe891, 0x2003],
    [0xe891, 0x8003],
    [0xe8b1, 0x0003],
  ] as const)
    expect(decodeAddress(first, second)).toBeUndefined();
});
