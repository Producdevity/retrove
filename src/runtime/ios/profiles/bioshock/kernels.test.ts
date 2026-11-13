import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../../web/cpu.mjs";
import { ArrayCopyEntry, installBioShockKernels, SkinningEntry } from "./kernels";
import { MpegEntry } from "./mpeg-kernel";
import type { KernelHost } from "./kernels";
async function fixture() {
  const cpu = await createCPU({ budget: "blocks" });
  const frame = 0x10000,
    data = 0x11000,
    fallback = 0x3000,
    gate = 0x7000;
  for (const [address, size] of [
    [0x89a000, 8192],
    [0x907000, 4096],
    [0x4ba000, 4096],
    [frame, 8192],
    [fallback, 12288],
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
  write(ArrayCopyEntry.Address, ArrayCopyEntry.ClearIndex);
  write(ArrayCopyEntry.Address + 4, ArrayCopyEntry.ArrayLoad);
  write(ArrayCopyEntry.Continue, ArrayCopyEntry.EpilogueAddress);
  write(MpegEntry.Address, MpegEntry.Frame);
  write(MpegEntry.Address + 4, MpegEntry.SavedRegisters);
  write(MpegEntry.Epilogue, MpegEntry.ReturnValue);
  write(frame + 8, 0);
  write(frame + 12, data + 512);
  write(frame + 16, data + 1024);
  cpu.setReg(4, 0);
  cpu.setReg(6, data);
  cpu.setReg(7, frame);
  cpu.setReg(8, data + 128);
  const callbacks: (() => { jump: number })[] = [];
  let nextFallback = fallback;
  const host: KernelHost = {
    cpu,
    heap: {
      alloc: () => {
        const address = nextFallback;
        nextFallback += 4096;
        return address;
      },
    },
    gate: (_name, run) => {
      callbacks.push(run);
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
    execute(entry = SkinningEntry.Address) {
      expect(cpu.run(entry, { count: 10 }).reason).toBe("trap");
      const invoke = callbacks[entry === SkinningEntry.Address ? 0 : 1];
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

test("wide-array bridge copies storage and falls back to the original constructor on aliasing", async () => {
  const f = await fixture();
  try {
    installBioShockKernels(f.host);
    const source = f.frame,
      destination = f.frame + 16,
      stack = f.frame + 128;
    f.write(source, f.data);
    f.write(source + 4, 3);
    f.write(source + 8, 3);
    f.write(destination, f.data + 128);
    f.write(destination + 4, 0);
    f.write(destination + 8, 3);
    f.write(stack + 36, destination);
    f.cpu.write(f.data, new Uint8Array(Uint32Array.of(65, 0, 0x1f984).buffer));
    f.cpu.setReg(2, source);
    f.cpu.setReg(3, 3);
    f.cpu.setReg(4, f.data + 128);
    f.cpu.setReg(13, stack);
    const registers = Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index));
    expect(f.execute(ArrayCopyEntry.Address)).toBe(ArrayCopyEntry.Continue);
    expect(Array.from({ length: 15 }, (_, index) => f.cpu.getReg(index))).toEqual(registers);
    expect(f.cpu.read(f.data + 128, 12)).toEqual(f.cpu.read(f.data, 12));
    f.write(destination + 4, 0);
    f.write(source, f.data + 128);
    expect(f.execute(ArrayCopyEntry.Address)).toBe(f.fallback + 4096);
    expect(
      f.cpu.run(f.fallback + 4096, { until: ArrayCopyEntry.Address + 8, count: 10 }).reason,
    ).toBe("until");
    expect(f.cpu.getReg(6)).toBe(0);
    expect(f.cpu.getReg(1)).toBe(destination);
  } finally {
    f.close();
  }
});
test("a mismatched array routine leaves the earlier skinning entry untouched", async () => {
  const f = await fixture();
  try {
    f.write(ArrayCopyEntry.Continue, 0);
    expect(() => installBioShockKernels(f.host)).toThrow(/instructions/);
    expect(new DataView(f.cpu.read(SkinningEntry.Address, 4).buffer).getUint32(0, true)).toBe(
      SkinningEntry.OutputLoad,
    );
  } finally {
    f.close();
  }
});
