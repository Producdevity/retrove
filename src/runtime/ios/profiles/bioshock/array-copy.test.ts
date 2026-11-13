import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../../web/cpu.mjs";
import { copyWideArray } from "./array-copy";
async function fixture() {
  const cpu = await createCPU(),
    source = 0x10000,
    destination = 0x10100,
    stack = 0x10200;
  cpu.map(0x10000, 8192);
  const write = (address: number, value: number) =>
    cpu.write(address, new Uint8Array(Uint32Array.of(value).buffer));
  write(source, 0x11000);
  write(source + 4, 4);
  write(source + 8, 4);
  write(destination, 0x11100);
  write(destination + 4, 0);
  write(destination + 8, 4);
  write(stack + 36, destination);
  cpu.write(0x11000, new Uint8Array(Uint32Array.of(0, 0x1f984, 0xffffffff, 0).buffer));
  cpu.write(0x11100, new Uint8Array(20).fill(0xa5));
  cpu.setReg(2, source);
  cpu.setReg(3, 4);
  cpu.setReg(4, 0x11100);
  cpu.setReg(13, stack);
  return { cpu, source, destination, write };
}
test("wide-array copy preserves raw code units and capacity, including embedded zeroes", async () => {
  const f = await fixture();
  try {
    expect(copyWideArray(f.cpu)).toBe(true);
    expect(f.cpu.read(0x11100, 16)).toEqual(f.cpu.read(0x11000, 16));
    expect([...f.cpu.read(0x11110, 4)]).toEqual([0xa5, 0xa5, 0xa5, 0xa5]);
    expect(new DataView(f.cpu.read(f.destination + 4, 8).buffer).getUint32(0, true)).toBe(4);
    expect(new DataView(f.cpu.read(f.destination + 4, 8).buffer).getUint32(4, true)).toBe(4);
    expect(f.cpu.getReg(2)).toBe(f.source);
  } finally {
    f.cpu.close();
  }
});
test("wide-array copy declines unsafe extents, overlapping buffers and incomplete construction", async () => {
  for (const invalid of [
    "capacity",
    "signed-capacity",
    "input-header",
    "count",
    "overlap",
    "destination",
    "empty",
    "large",
  ]) {
    const f = await fixture();
    try {
      if (invalid === "capacity") f.cpu.setReg(3, 3);
      if (invalid === "signed-capacity") {
        f.cpu.setReg(3, 0xffffffff);
        f.write(f.destination + 8, 0xffffffff);
      }
      if (invalid === "input-header") f.write(f.source, f.destination);
      if (invalid === "count") f.write(f.destination + 4, 1);
      if (invalid === "overlap") f.write(f.source, 0x11100);
      if (invalid === "destination") f.write(f.destination, 0x11000);
      if (invalid === "empty") f.write(f.source + 4, 0);
      if (invalid === "large") f.write(f.source + 4, 0xffffffff);
      const before = f.cpu.read(0x10000, 8192);
      expect(copyWideArray(f.cpu)).toBe(false);
      expect(f.cpu.read(0x10000, 8192)).toEqual(before);
    } finally {
      f.cpu.close();
    }
  }
});
