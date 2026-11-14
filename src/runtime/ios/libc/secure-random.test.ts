import { expect, test } from "vite-plus/test";
import { secureRandomImports } from "./secure-random";
import type { EntropySource } from "./secure-random";
const unusedWrite = () => {
  throw new Error("Unexpected byte output");
};
function scripted(values: readonly number[]): EntropySource {
  return (target) => {
    for (let index = 0; index < target.length; index++) target[index] = values[index] ?? 0;
  };
}
test("arc4random preserves unsigned boundary values and refills a small pool without repeating consumed words", () => {
  const boundary = secureRandomImports(
    { write: unusedWrite },
    scripted([0, 0xffffffff, 0x80000000]),
  );
  expect([boundary._arc4random(), boundary._arc4random(), boundary._arc4random()]).toEqual([
    0, 0xffffffff, 0x80000000,
  ]);
  let next = 0,
    requests = 0;
  const api = secureRandomImports({ write: unusedWrite }, (target) => {
    requests++;
    for (let i = 0; i < target.length; i++) target[i] = ++next;
  });
  for (let i = 1; i <= 2048; i++) expect(api._arc4random()).toBe(i);
  expect(requests).toBeGreaterThan(1);
  expect(requests).toBeLessThan(32);
});
test("arc4random_uniform rejects biased low words and handles bounds above signed integer range", () => {
  const small = secureRandomImports({ write: unusedWrite }, scripted([0, 5, 7, 0xffffffff]));
  expect(small._arc4random_uniform(() => 10)).toBe(7);
  expect(small._arc4random_uniform(() => 0)).toBe(0);
  expect(small._arc4random_uniform(() => 1)).toBe(0);
  expect(small._arc4random()).toBe(0xffffffff);
  const large = secureRandomImports({ write: unusedWrite }, scripted([0x7ffffffe, 0x80000000]));
  expect(large._arc4random_uniform(() => 0x80000001)).toBe(0x80000000);
});
test("arc4random_buf respects the Web Crypto request limit and guest output bounds", () => {
  const output = new Uint8Array(65700),
    lengths: number[] = [];
  const api = secureRandomImports(
    {
      write: (p, b) => {
        output.set(b, p);
      },
    },
    (target) => {
      lengths.push(target.byteLength);
      target.fill(0xa5);
    },
  );
  const args = [64, 65539];
  api._arc4random_buf((index) => args[index] ?? 0);
  expect(lengths).toEqual([65536, 3]);
  expect(output.slice(64, 65603).every((b) => b === 0xa5)).toBe(true);
  expect(output[63]).toBe(0);
  expect(output[65603]).toBe(0);
  api._arc4random_buf(() => 0);
  expect(lengths).toHaveLength(2);
  const overflow = [0xfffffff0, 32];
  expect(() => api._arc4random_buf((i) => overflow[i] ?? 0)).toThrow(/address space/);
});
