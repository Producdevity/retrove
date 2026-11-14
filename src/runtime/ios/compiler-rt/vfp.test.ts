import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { vfpBuiltins } from "./vfp";
async function fixture() {
  const cpu = await createCPU(),
    base = 0x1000,
    returnTo = 0x1ffc;
  cpu.map(base, 4096);
  const helpers = vfpBuiltins(cpu, { alloc: () => base }),
    bits = new DataView(new ArrayBuffer(8));
  const single = (value: number) => {
    bits.setFloat32(0, value, true);
    return bits.getUint32(0, true);
  };
  const double = (value: number) => {
    bits.setFloat64(0, value, true);
    return [bits.getUint32(0, true), bits.getUint32(4, true)];
  };
  const call = (name: string, ...args: number[]) => {
    const pointer = helpers.get("___" + name);
    if (pointer === undefined) throw new Error("Missing compiler builtin " + name);
    for (let reg = 4; reg <= 11; reg++) cpu.setReg(reg, 0x12340000 + reg);
    args.forEach((value, index) => cpu.setReg(index, value));
    cpu.setReg(14, returnTo);
    expect(cpu.run(pointer, { until: returnTo, count: 100 }).reason).toBe("until");
    for (let reg = 4; reg <= 11; reg++) expect(cpu.getReg(reg)).toBe(0x12340000 + reg);
    return cpu.getReg(0);
  };
  const result = (wide: boolean) => {
    bits.setUint32(0, cpu.getReg(0), true);
    if (wide) bits.setUint32(4, cpu.getReg(1), true);
    return wide ? bits.getFloat64(0, true) : bits.getFloat32(0, true);
  };
  return { cpu, single, double, call, result };
}
test("Darwin VFP arithmetic returns floating-point bits in general registers", async () => {
  const x = await fixture();
  try {
    const operations = [
      ["add", (a: number, b: number) => a + b],
      ["sub", (a: number, b: number) => a - b],
      ["mul", (a: number, b: number) => a * b],
      ["div", (a: number, b: number) => a / b],
    ] as const;
    for (const wide of [false, true])
      for (const [name, calculate] of operations)
        for (const a of [-Infinity, -3.5, -0, 0, 1, 2, Infinity, NaN])
          for (const b of [-2, -0, 0, 1.25, Infinity, NaN]) {
            const expected = calculate(a, b),
              args = wide ? [...x.double(a), ...x.double(b)] : [x.single(a), x.single(b)];
            x.call(name + (wide ? "df3vfp" : "sf3vfp"), ...args);
            const actual = x.result(wide);
            if (Number.isNaN(expected)) expect(Number.isNaN(actual)).toBe(true);
            else expect(actual).toBe(wide ? expected : Math.fround(expected));
          }
  } finally {
    x.cpu.close();
  }
});
test("Darwin VFP comparison helpers return booleans and reject unordered relational comparisons", async () => {
  const x = await fixture();
  try {
    const comparisons = [
      ["eq", (a: number, b: number) => a === b],
      ["ne", (a: number, b: number) => a !== b],
      ["ge", (a: number, b: number) => a >= b],
      ["gt", (a: number, b: number) => a > b],
      ["le", (a: number, b: number) => a <= b],
      ["lt", (a: number, b: number) => a < b],
      ["unord", (a: number, b: number) => Number.isNaN(a) || Number.isNaN(b)],
    ] as const;
    for (const wide of [false, true])
      for (const [name, compare] of comparisons)
        for (const a of [-Infinity, -1, -0, 0, 1, Infinity, NaN])
          for (const b of [-Infinity, -1, -0, 0, 1, Infinity, NaN])
            expect(
              x.call(
                name + (wide ? "df2vfp" : "sf2vfp"),
                ...(wide ? [...x.double(a), ...x.double(b)] : [x.single(a), x.single(b)]),
              ),
            ).toBe(Number(compare(a, b)));
  } finally {
    x.cpu.close();
  }
});
test("Darwin VFP conversions preserve signed and unsigned boundaries and truncate toward zero", async () => {
  const x = await fixture();
  try {
    for (const word of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      expect(x.call("floatsisfvfp", word)).toBe(x.single(word | 0));
      expect(x.call("floatunssisfvfp", word)).toBe(x.single(word));
      x.call("floatsidfvfp", word);
      expect(x.result(true)).toBe(word | 0);
      x.call("floatunssidfvfp", word);
      expect(x.result(true)).toBe(word);
    }
    for (const value of [-2147483648, -123.75, -0.25, 0, 1.75, 12345.125]) {
      expect(x.call("fixsfsivfp", x.single(value)) | 0).toBe(Math.trunc(Math.fround(value)) || 0);
      expect(x.call("fixdfsivfp", ...x.double(value)) | 0).toBe(Math.trunc(value) || 0);
      x.call("extendsfdf2vfp", x.single(value));
      expect(x.result(true)).toBe(Math.fround(value));
      expect(x.call("truncdfsf2vfp", ...x.double(value))).toBe(x.single(value));
    }
    for (const value of [0, 1.75, 2147483648, 4294967295])
      expect(x.call("fixunsdfsivfp", ...x.double(value))).toBe(Math.trunc(value));
  } finally {
    x.cpu.close();
  }
});
