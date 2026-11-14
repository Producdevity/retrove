import { expect, test } from "vite-plus/test";
import { parseMethodEncoding } from "./encoding";
test("method encodings retain qualifiers and use Darwin ARM32 aggregate alignment", () => {
  const value = parseMethodEncoding('Vv32@0:4r^{Pair="x"c"y"d}8[3s]12@"Value"20');
  expect(value.oneway).toBe(true);
  expect(value.arguments.map((type) => [type.encoding, type.size])).toEqual([
    ["@", 4],
    [":", 4],
    ['r^{Pair="x"c"y"d}', 4],
    ["[3s]", 6],
    ['@"Value"', 4],
  ]);
  const aggregate = parseMethodEncoding("{Mixed=cd}@:");
  expect(aggregate.result.size).toBe(12);
  expect(aggregate.result.alignment).toBe(4);
});
test("invalid method signatures fail before allocating invocation storage", () => {
  for (const value of [
    "",
    "v",
    "v@",
    "v@:v",
    "v@:[-1i]",
    "v@:[9999999999i]",
    "v@:{Opaque}",
    "v@:(Union=if)",
    'v@:@"unfinished',
  ])
    expect(() => parseMethodEncoding(value)).toThrow();
});
