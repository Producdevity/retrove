import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../../web/cpu.mjs";
import { installBioShockAudioKernel, MpegEntry } from "./mpeg-kernel";
async function fixture() {
  const cpu = await createCPU({ budget: "blocks" }),
    input = 0x10000,
    window = 0x11000,
    output = 0x12000,
    stack = 0x13000,
    fallback = 0x14000,
    gate = 0x15000,
    done = 0x16000;
  for (const address of [input, window, output, stack, fallback, gate, done, 0x4ba000, 0x1ad4000])
    cpu.map(address, 4096);
  const write = (address: number, value: number) =>
    cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
  write(MpegEntry.Address, MpegEntry.Frame);
  write(MpegEntry.Address + 4, MpegEntry.SavedRegisters);
  write(MpegEntry.Epilogue, MpegEntry.ReturnValue);
  write(MpegEntry.WindowPointer, 0x1ad4f00);
  write(0x1ad4f00, window);
  for (let offset = 0; offset < 1088; offset += 4) write(input + offset, 0x3f800000);
  for (let offset = 0; offset < 2176; offset += 4) write(window + offset, 0x3f800000);
  cpu.write(output, new Uint8Array(128).fill(0xa5));
  cpu.setReg(1, input);
  cpu.setReg(2, 0);
  cpu.setReg(3, 2);
  cpu.setReg(13, stack + 2048);
  cpu.setReg(14, done);
  write(stack + 2048, output);
  let invoke: (() => { jump: number }) | undefined;
  const release = cpu.trap(gate, () => {});
  return {
    cpu,
    input,
    window,
    output,
    stack,
    fallback,
    done,
    write,
    install: () =>
      installBioShockAudioKernel({
        cpu,
        heap: { alloc: () => fallback },
        gate: (_name, run) => {
          invoke = run;
          return gate;
        },
      }),
    execute: () => {
      expect(cpu.run(MpegEntry.Address + 1, { count: 10 }).reason).toBe("trap");
      if (!invoke) throw new Error("Missing kernel");
      return invoke().jump;
    },
    close: () => {
      release();
      cpu.close();
    },
  };
}
test("MPEG Thumb bridge returns PCM without changing the caller's preserved registers", async () => {
  const f = await fixture();
  try {
    f.install();
    const registers = Array.from({ length: 14 }, (_, i) => f.cpu.getReg(i + 1));
    expect(f.execute()).toBe(f.done);
    expect(f.cpu.getReg(0)).toBe(0);
    expect(Array.from({ length: 14 }, (_, i) => f.cpu.getReg(i + 1))).toEqual(registers);
    const output = new DataView(f.cpu.read(f.output, 128).buffer);
    for (let i = 0; i < 32; i++) {
      expect(output.getInt16(i * 4, true)).toBe(i < 16 ? 0 : i === 16 ? 32767 : -32768);
      expect(output.getUint16(i * 4 + 2, true)).toBe(0xa5a5);
    }
  } finally {
    f.close();
  }
});
test("unsafe MPEG arguments resume the original Thumb prologue", async () => {
  const f = await fixture();
  try {
    f.install();
    f.cpu.setReg(2, 16);
    f.cpu.setReg(4, 0x12345678);
    expect(f.execute()).toBe(f.fallback + 1);
    expect(f.cpu.run(f.fallback + 1, { until: MpegEntry.Address + 8, count: 10 }).reason).toBe(
      "until",
    );
    expect(f.cpu.getReg(13)).toBe(f.stack + 2048 - 32);
    expect(new DataView(f.cpu.read(f.stack + 2048 - 20, 4).buffer).getUint32(0, true)).toBe(
      0x12345678,
    );
  } finally {
    f.close();
  }
});
test("MPEG installation refuses an unknown routine", async () => {
  const f = await fixture();
  try {
    f.write(MpegEntry.Epilogue, 0);
    expect(f.install).toThrow(/instructions/);
    expect(new DataView(f.cpu.read(MpegEntry.Address, 4).buffer).getUint32(0, true)).toBe(
      MpegEntry.Frame,
    );
  } finally {
    f.close();
  }
});
