import { expect, test } from "vite-plus/test";
import { addPercentEscapes, replacePercentEscapes } from "./percent-escapes";
const cases: [string, number, string | null, string | null][] = [
  [
    "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    1,
    "%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20!%22%23$%25&'()*+,-./0123456789:;%3C=%3E?@ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~%7F",
    null,
  ],
  [
    "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    4,
    "%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20!%22%23$%25&'()*+,-./0123456789:;%3C=%3E?@ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~%7F",
    null,
  ],
  [
    "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    5,
    "%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20!%22%23$%25&'()*+,-./0123456789:;%3C=%3E?@ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~%7F",
    null,
  ],
  ["https://example.test/a b?q=café&x=1#frag", 1, null, "https://example.test/a b?q=café&x=1#frag"],
  [
    "https://example.test/a b?q=café&x=1#frag",
    4,
    "https://example.test/a%20b?q=caf%C3%A9&x=1%23frag",
    "https://example.test/a b?q=café&x=1#frag",
  ],
  [
    "https://example.test/a b?q=café&x=1#frag",
    5,
    "https://example.test/a%20b?q=caf%E9&x=1%23frag",
    "https://example.test/a b?q=café&x=1#frag",
  ],
  ["café", 1, null, "café"],
  ["café", 4, "caf%C3%A9", "café"],
  ["café", 5, "caf%E9", "café"],
  ["é 🎮", 1, null, "é 🎮"],
  ["é 🎮", 4, "%C3%A9%20%F0%9F%8E%AE", "é 🎮"],
  ["é 🎮", 5, null, "é 🎮"],
  ["a%20b%2Fc%ZZ", 1, "a%2520b%252Fc%25ZZ", null],
  ["a%20b%2Fc%ZZ", 4, "a%2520b%252Fc%25ZZ", null],
  ["a%20b%2Fc%ZZ", 5, "a%2520b%252Fc%25ZZ", null],
];
test("legacy URL escaping matches native Foundation ASCII, UTF8 and Latin1 output", () => {
  for (const [input, encoding, encoded, decoded] of cases) {
    expect(addPercentEscapes(input, encoding)).toBe(encoded);
    expect(replacePercentEscapes(input, encoding)).toBe(decoded);
  }
});
test("legacy URL escapes preserve plus signs, decode encoded bytes and reject malformed sequences", () => {
  expect(replacePercentEscapes("a%20b%2Fc+d", 4)).toBe("a b/c+d");
  expect(replacePercentEscapes("%E9", 5)).toBe("é");
  expect(replacePercentEscapes("%E9", 4)).toBe(null);
  expect(replacePercentEscapes("%C3%A9", 4)).toBe("é");
  expect(addPercentEscapes("\ud800", 4)).toBe(null);
  for (const value of ["%", "%A", "%GG"]) expect(replacePercentEscapes(value, 4)).toBe(null);
});
