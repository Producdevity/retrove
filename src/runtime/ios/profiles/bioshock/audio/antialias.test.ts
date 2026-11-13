import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../../../web/cpu.mjs";
import { AntialiasEntry, prepareBioShockAntialias } from "./antialias";
async function fixture() {
  const cpu = await createCPU({ budget: "blocks" });
  cpu.map(0x10000, 0x8000);
  cpu.map(0x4be000, 4096);
  const write = (address: number, value: number) =>
    cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
  const body = new Uint8Array(AntialiasEntry.End - AntialiasEntry.Address),
    view = new DataView(body.buffer);
  for (let i = 0; i < body.length; i += 4) view.setUint32(i, 0x0110ef20, true);
  view.setUint32(0, AntialiasEntry.Load, true);
  view.setUint32(4, AntialiasEntry.Decrement, true);
  view.setUint32(8, 0x1a07ed01, true);
  cpu.write(AntialiasEntry.Address, body);
  write(AntialiasEntry.End, AntialiasEntry.Advance);
  write(AntialiasEntry.Return, AntialiasEntry.ReturnWord);
  for (let at = 0; at < 2304; at += 4) write(0x10000 + at, at);
  cpu.setReg(1, 0x10064);
  cpu.setReg(2, 0x14000);
  cpu.setReg(3, 0x14020);
  cpu.setReg(9, 3);
  let callback: (() => { jump: number }) | undefined;
  const release = cpu.trap(0x17000, () => {});
  return {
    cpu,
    write,
    install: () =>
      prepareBioShockAntialias(cpu)({
        cpu,
        heap: { alloc: () => 0x16000 },
        gate: (_name, run) => {
          callback = run;
          return 0x17000;
        },
      }),
    execute: () => {
      expect(cpu.run(AntialiasEntry.Address + 1, { count: 10 }).reason).toBe("trap");
      if (!callback) throw new Error("Missing kernel.");
      return callback().jump;
    },
    close: () => {
      release();
      cpu.close();
    },
  };
}
test("alias-reduction bridge processes only the requested bands and preserves intervening bytes", async () => {
  const f = await fixture();
  try {
    f.install();
    const expected = f.cpu.read(0x10000, 2304),
      view = new DataView(expected.buffer);
    for (let band = 0; band < 3; band++) view.setUint32(72 + band * 72, 68 + band * 72, true);
    expect(f.execute()).toBe(AntialiasEntry.Return + 1);
    expect(f.cpu.read(0x10000, 2304)).toEqual(expected);
    expect(f.cpu.getReg(9)).toBe(0);
    expect(f.cpu.getReg(1)).toBe(0x10064 + 216);
  } finally {
    f.close();
  }
});
test("alias-reduction rejects aliasing and unbounded counts without modifying sample buffers", async () => {
  const f = await fixture();
  try {
    f.install();
    const before = f.cpu.read(0x10000, 2304);
    for (const count of [0, 32, 0xffffffff]) {
      f.cpu.setReg(9, count);
      expect(f.execute()).toBe(0x16001);
    }
    f.cpu.setReg(9, 3);
    f.cpu.setReg(2, 0x10028);
    expect(f.execute()).toBe(0x16001);
    expect(f.cpu.read(0x10000, 2304)).toEqual(before);
    expect(f.cpu.run(0x16001, { until: AntialiasEntry.Address + 8, count: 10 }).reason).toBe(
      "until",
    );
    expect(f.cpu.getReg(9)).toBe(2);
  } finally {
    f.close();
  }
});
test("an unexpected alias-reduction loop is rejected before entry mutation", async () => {
  const f = await fixture();
  try {
    f.write(AntialiasEntry.Address + 4, 0);
    expect(f.install).toThrow(/instructions/);
    expect(f.cpu.read(AntialiasEntry.Address, 4)).toEqual(
      new Uint8Array(Uint32Array.of(AntialiasEntry.Load).buffer),
    );
  } finally {
    f.close();
  }
});
