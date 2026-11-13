import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../../web/cpu.mjs";
import { installBioShockKernels, SkinningEntry } from "./kernels";
import type { KernelHost } from "./kernels";
async function fixture() {
  const cpu = await createCPU({ budget: "blocks" });
  const frame = 0x10000,
    data = 0x11000,
    fallback = 0x3000,
    gate = 0x5000;
  for (const [address, size] of [
    [0x89a000, 8192],
    [frame, 8192],
    [fallback, 4096],
    [gate, 4096],
  ]) {
    if (address === undefined || size === undefined) throw new Error("Invalid test memory.");
    cpu.map(address, size);
  }
  const write = (address: number, value: number) =>
    cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
  write(SkinningEntry.Address, SkinningEntry.OutputLoad);
  write(SkinningEntry.Address + 4, SkinningEntry.CountCompare);
  write(SkinningEntry.Continue, SkinningEntry.EpilogueLoad);
  write(frame + 8, 0);
  write(frame + 12, data + 512);
  write(frame + 16, data + 1024);
  cpu.setReg(4, 0);
  cpu.setReg(6, data);
  cpu.setReg(7, frame);
  cpu.setReg(8, data + 128);
  let invoke: (() => { jump: number }) | undefined;
  const host: KernelHost = {
    cpu,
    heap: { alloc: () => fallback },
    gate: (_name, run) => {
      invoke = run;
      return gate;
    },
  };
  const release = cpu.trap(gate, () => {});
  return {
    cpu,
    host,
    write,
    frame,
    data,
    fallback,
    execute() {
      expect(cpu.run(SkinningEntry.Address, { count: 10 }).reason).toBe("trap");
      if (!invoke) throw new Error("Kernel was not installed.");
      return invoke().jump;
    },
    close() {
      release();
      cpu.close();
    },
  };
}
test("skinning bridge preserves registers, output padding and both vertex streams", async () => {
  const f = await fixture();
  try {
    installBioShockKernels(f.host);
    expect(f.execute()).toBe(SkinningEntry.Continue);
    for (const offset of [0, 20, 40, 60]) f.write(f.data + 512 + offset, 0x3f800000);
    f.write(f.data, 0x3f800000);
    f.write(f.data + 128, 0x40000000);
    f.cpu.write(f.data + 128 + 36, Uint8Array.of(255));
    f.cpu.write(f.data + 1024, new Uint8Array(80).fill(0xa5));
    f.cpu.setReg(4, 1);
    f.write(f.frame + 8, 1);
    const registers = Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index));
    expect(f.execute()).toBe(SkinningEntry.Continue);
    expect(Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index))).toEqual(registers);
    const bytes = f.cpu.read(f.data + 1024, 80),
      result = new DataView(bytes.buffer);
    expect(result.getFloat32(0, true)).toBe(1);
    expect(result.getFloat32(40, true)).toBe(2);
    expect([...bytes.subarray(32, 40)]).toEqual(Array(8).fill(0xa5));
    expect([...bytes.subarray(72)]).toEqual(Array(8).fill(0xa5));
  } finally {
    f.close();
  }
});
test("large and overlapping buffers execute the original prologue before continuing", async () => {
  const f = await fixture();
  try {
    installBioShockKernels(f.host);
    for (const count of [1, 4097]) {
      f.cpu.setReg(4, count);
      f.write(f.frame + 16, f.data);
      expect(f.execute()).toBe(f.fallback);
      expect(f.cpu.run(f.fallback, { until: SkinningEntry.Address + 8, count: 10 }).reason).toBe(
        "until",
      );
      expect(f.cpu.getReg(0)).toBe(f.data);
      expect(f.cpu.getReg(4)).toBe(count);
    }
  } finally {
    f.close();
  }
});
test("kernel installation rejects unexpected instructions before allocating or patching", async () => {
  const f = await fixture();
  try {
    f.write(SkinningEntry.Address + 4, 0);
    expect(() => installBioShockKernels(f.host)).toThrow(/instructions/);
    expect(new DataView(f.cpu.read(SkinningEntry.Address, 4).buffer).getUint32(0, true)).toBe(
      SkinningEntry.OutputLoad,
    );
  } finally {
    f.close();
  }
});
