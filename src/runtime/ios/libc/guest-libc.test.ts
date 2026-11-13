import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { guestLibc } from "./guest-libc";
async function fixture() {
  const cpu = await createCPU();
  const base = 0x1000,
    destination = 0x8000,
    source = 0x9000,
    fallback = 0x4000;
  const returnTo = 0x1ffc;
  cpu.map(base, 4096);
  cpu.map(destination, 8192);
  cpu.map(fallback, 4096);
  cpu.write(fallback, Uint8Array.of(0xf0, 0, 0xf0, 0xe7));
  const helpers = guestLibc(cpu, { alloc: () => base }, fallback);
  function call(symbol: string, ...args: number[]): number {
    const address = helpers.get(symbol);
    if (address === undefined) throw new Error("Missing test helper.");
    args.forEach((argument, index) => cpu.setReg(index, argument));
    cpu.setReg(14, returnTo);
    expect(cpu.run(address, { until: returnTo, count: 10000 }).reason).toBe("until");
    return cpu.getReg(0);
  }
  const words = (values: number[]) => new Uint8Array(new Int32Array([...values, 0]).buffer);
  return { cpu, call, words, destination, source, fallback, helpers, returnTo };
}
test("ARM helpers preserve Darwin character and wide-string semantics", async () => {
  const { cpu, call, words, destination, source } = await fixture();
  try {
    for (let character = -1; character <= 256; character++)
      expect(call("___toupper", character) | 0).toBe(
        character >= 97 && character <= 122 ? character - 32 : character,
      );
    for (const values of [[], [65], [65, 0x1f3ae, 0x10400]]) {
      cpu.write(source, words(values));
      expect(call("_wcslen", source)).toBe(values.length);
      expect(call("_wcscpy", destination, source)).toBe(destination);
      expect(cpu.read(destination, (values.length + 1) * 4)).toEqual(words(values));
      expect(call("_wcscmp", destination, source)).toBe(0);
    }
    for (const [left = 0, right = 0] of [
      [-1, 1],
      [0x7fffffff, -1],
      [0, 1],
      [10, 9],
    ]) {
      cpu.write(destination, words([left]));
      cpu.write(source, words([right]));
      expect(call("_wcscmp", destination, source) | 0).toBe(Math.sign(left - right));
    }
    cpu.write(source + 4092, words([]));
    expect(call("_wcslen", source + 4092)).toBe(0);
  } finally {
    cpu.close();
  }
});
test("small ARM copies preserve guards and large copies use the host fallback", async () => {
  const { cpu, call, destination, source, fallback, helpers, returnTo } = await fixture();
  try {
    for (const size of [0, 1, 3, 4, 63, 64]) {
      cpu.write(
        source,
        Uint8Array.from({ length: 128 }, (_, index) => index),
      );
      cpu.write(destination, new Uint8Array(128).fill(0xaa));
      expect(call("_memcpy", destination + 1, source + 1, size)).toBe(destination + 1);
      expect(cpu.read(destination + 1, size)).toEqual(cpu.read(source + 1, size));
      expect(cpu.read(destination, 1)[0]).toBe(0xaa);
      expect(cpu.read(destination + 1 + size, 1)[0]).toBe(0xaa);
    }
    let called = false;
    cpu.trap(fallback, () => {
      called = true;
    });
    const address = helpers.get("_memcpy");
    if (address === undefined) throw new Error("Missing memcpy helper.");
    cpu.setReg(0, destination);
    cpu.setReg(1, source);
    cpu.setReg(2, 65);
    cpu.setReg(14, returnTo);
    expect(cpu.run(address, { until: returnTo }).reason).toBe("trap");
    expect(called).toBe(true);
    expect([cpu.getReg(0), cpu.getReg(1), cpu.getReg(2), cpu.getReg(14)]).toEqual([
      destination,
      source,
      65,
      returnTo,
    ]);
  } finally {
    cpu.close();
  }
});
