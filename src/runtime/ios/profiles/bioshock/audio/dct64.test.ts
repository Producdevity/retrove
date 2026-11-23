import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../cpu/cpu";
import { Dct64Entry, prepareBioShockDct64 } from "./dct64";
async function fixture() {
  const cpu = await createCPU({ budget: "blocks" });
  for (const [address, size] of [
    [0x10000, 0x8000],
    [0x4b9000, 8192],
    [0x1ad4000, 4096],
  ]) {
    if (address === undefined || size === undefined) throw new Error("Invalid fixture.");
    cpu.map(address, size);
  }
  const write = (address: number, value: number) =>
    cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
  write(Dct64Entry.Address, Dct64Entry.First);
  write(Dct64Entry.Address + 4, Dct64Entry.Second);
  write(Dct64Entry.End, Dct64Entry.Epilogue);
  const body = new Uint8Array(Dct64Entry.End - Dct64Entry.Start),
    view = new DataView(body.buffer);
  for (let i = 0; i < body.length; i += 2) view.setUint16(i, 0xac00, true);
  view.setUint32(0, 0x0a00ed92, true);
  view.setUint32(4, 0x0a00ed80, true);
  cpu.write(Dct64Entry.Start, body);
  for (const [reg, address] of [
    [0, 0x10000],
    [1, 0x11000],
    [2, 0x12000],
    [3, 0x13000],
    [13, 0x15400],
    [14, 0x17000],
  ]) {
    if (reg === undefined || address === undefined) throw new Error("Invalid register fixture.");
    cpu.setReg(reg, address);
  }
  write(Dct64Entry.TablePointer, 0x14000);
  for (let index = 0; index < 5; index++) write(0x14000 + index * 4, 0x14500 + index * 256);
  write(0x12000, 0x7f800001);
  let invoke: (() => { jump: number }) | undefined;
  const release = cpu.trap(0x17000, () => {});
  return {
    cpu,
    write,
    install: () =>
      prepareBioShockDct64(cpu)({
        cpu,
        heap: { alloc: () => 0x16000 },
        gate: (_name, run) => {
          invoke = run;
          return 0x17000;
        },
      }),
    execute: () => {
      expect(cpu.run(Dct64Entry.Address + 1, { count: 10 }).reason).toBe("trap");
      if (!invoke) throw new Error("Missing kernel.");
      return invoke().jump;
    },
    close: () => {
      release();
      cpu.close();
    },
  };
}
test("compiled decoder bridge preserves caller registers and raw output bits", async () => {
  const f = await fixture();
  try {
    f.install();
    const registers = Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index));
    expect(f.execute()).toBe(0x17000);
    expect(f.cpu.read(0x12000, 4)).toEqual(f.cpu.read(0x10000, 4));
    expect(Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index))).toEqual(registers);
  } finally {
    f.close();
  }
});
test("decoder aliasing and unaligned arguments resume the original Thumb prologue", async () => {
  const f = await fixture();
  try {
    f.install();
    f.cpu.setReg(0, 0x12000);
    f.cpu.setReg(4, 0x12345678);
    expect(f.execute()).toBe(0x16001);
    expect(f.cpu.run(0x16001, { until: Dct64Entry.Address + 8, count: 10 }).reason).toBe("until");
    expect(f.cpu.getReg(13)).toBe(0x15400 - 12);
    expect(f.cpu.getReg(4)).toBe(0x15400 - 12 - 64);
    expect(f.cpu.read(0x15400 - 12, 4)).toEqual(new Uint8Array(Uint32Array.of(0x12345678).buffer));
    f.cpu.setReg(13, 0x15400);
    f.cpu.setReg(0, 0x10000);
    f.cpu.setReg(2, 0x12001);
    expect(f.execute()).toBe(0x16001);
    f.cpu.setReg(2, 0x12000);
    f.write(0x14000, 0x10000);
    expect(f.execute()).toBe(0x16001);
  } finally {
    f.close();
  }
});
test("unknown decoder bytes are rejected before patching the entry", async () => {
  const f = await fixture();
  try {
    f.write(Dct64Entry.Start, 0);
    expect(f.install).toThrow(/Unsupported/);
    expect(f.cpu.read(Dct64Entry.Address, 4)).toEqual(
      new Uint8Array(Uint32Array.of(Dct64Entry.First).buffer),
    );
    f.write(Dct64Entry.End, 0);
    expect(f.install).toThrow(/instructions/);
  } finally {
    f.close();
  }
});
