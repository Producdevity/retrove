import { expect, test } from "vite-plus/test";
import { replaceOccurrences, replaceRange } from "./replacement";
const cases: [string, string, string, number, number, number, string, number][] = [
  ["banana", "ana", "X", 0, 0, 6, "bXna", 1],
  ["banana", "ana", "X", 4, 0, 6, "banX", 1],
  ["abab", "ab", "X", 8, 0, 4, "XX", 2],
  ["abab", "ab", "X", 12, 0, 4, "XX", 2],
  ["aaaaa", "aa", "X", 0, 0, 5, "XXa", 2],
  ["aaaaa", "aa", "X", 4, 0, 5, "aXX", 2],
  ["--ABa aBA--", "aba", "$&", 1, 2, 7, "--$& $&--", 2],
  ["banana", "", "X", 0, 0, 6, "banana", 0],
  ["a🌟b🌟c", "🌟", "🚀", 0, 1, 5, "a🚀b🚀c", 2],
  ["é é", "é", "X", 0, 0, 4, "X X", 2],
  ["é é", "é", "X", 2, 0, 4, "é X", 1],
  ["é e", "e", "X", 0, 0, 3, "é X", 1],
  ["é e", "e", "X", 128, 0, 3, "X X", 2],
  ["Straße STRASSE", "strasse", "X", 1, 0, 14, "X X", 2],
  ["banana", "a", "X", 64, 0, 6, "bXnXnX", 3],
  ["É é", "é", "X", 1, 0, 3, "X X", 2],
  ["İ i ı I", "i", "X", 1, 0, 7, "İ X ı X", 2],
];
test("NSString replacement matches native Foundation ranges, direction, canonical and caseless matching", () => {
  for (const [value, target, replacement, options, location, length, result, count] of cases)
    expect(replaceOccurrences(value, target, replacement, options, location, length)).toEqual({
      value: result,
      count,
    });
});
test("string replacement rejects invalid ranges and unimplemented options before mutation", () => {
  for (const [location, length] of [
    [-1, 0],
    [7, 0],
    [5, 2],
    [0, NaN],
    [Infinity, 0],
  ])
    expect(() => replaceOccurrences("banana", "a", "X", 0, location ?? 0, length ?? 0)).toThrow(
      /range/,
    );
  expect(() => replaceOccurrences("banana", "a", "X", 1024, 0, 6)).toThrow(/Unsupported/);
  expect(replaceRange("a🌟b", "XY", 1, 2)).toBe("aXYb");
});
