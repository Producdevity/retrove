import { expect, test } from "vite-plus/test";
import { CharacterSet } from "./character-set";
import { TextScanner } from "./text-scanner";

// Results captured from Apple's NSScanner through an independent Objective-C executable.
const nativeCases = [
  { source: "iPhone5,1", value: null, location: 0, atEnd: false },
  { source: "  - 42tail", value: -42, location: 6, atEnd: false },
  { source: "+", value: null, location: 0, atEnd: false },
  { source: "  214748364999tail", value: 2147483647, location: 14, atEnd: false },
  { source: "-214748364999", value: -2147483648, location: 13, atEnd: true },
  { source: "١٢٣", value: 123, location: 3, atEnd: true },
  { source: "  x", value: null, location: 0, atEnd: false },
  { source: "\u200B5", value: 5, location: 2, atEnd: true },
  { source: "\uFEFF5", value: null, location: 0, atEnd: false },
];
for (const native of nativeCases) {
  test(`matches Foundation integer scanning for ${JSON.stringify(native.source)}`, () => {
    const scanner = new TextScanner(native.source);
    expect(scanner.integer()).toBe(native.value);
    expect(scanner.location).toBe(native.location);
    expect(scanner.atEnd).toBe(native.atEnd);
  });
}

test("parses the hardware identifier using a decimal character set and sequential scans", () => {
  const scanner = new TextScanner("iPhone5,1");
  const digits = CharacterSet.decimal();
  expect(scanner.characters(digits, true)).toBe("iPhone");
  expect(scanner.integer()).toBe(5);
  expect(scanner.string(",")).toBe(",");
  expect(scanner.integer()).toBe(1);
  expect(scanner.atEnd).toBe(true);
});

test("a nil skipped set preserves spaces and locations use UTF-16 units", () => {
  const scanner = new TextScanner("🎮 12");
  scanner.skipped = CharacterSet.empty();
  scanner.location = "🎮".length;
  expect(scanner.integer()).toBeNull();
  expect(scanner.characters(CharacterSet.characters(" "))).toBe(" ");
  expect(scanner.integer()).toBe(12);
});

test("failed scans preserve position and case sensitivity can be changed", () => {
  const scanner = new TextScanner("  Alpha,BETA");
  expect(scanner.string("missing")).toBeNull();
  expect(scanner.location).toBe(0);
  expect(scanner.string("alpha")).toBe("Alpha");
  expect(scanner.string(",")).toBe(",");
  scanner.caseSensitive = true;
  expect(scanner.string("beta")).toBeNull();
  expect(scanner.string("BETA")).toBe("BETA");
});

for (const [source, value, location] of [
  [" 0xff!", 255, 5],
  ["-1", null, 0],
  ["+FF", null, 0],
  ["0x", 0, 1],
  ["0xg", 0, 1],
  ["  ff", 255, 4],
  ["FFFFFFFFF", 4294967295, 9],
  ["١٢", null, 0],
  ["0XAB", 171, 4],
  [" ff 00", 255, 3],
  ["0x 12", 0, 1],
] as const)
  test(`matches Foundation hexadecimal scanning for ${source}`, () => {
    const scanner = new TextScanner(source);
    expect(scanner.hexInteger()).toBe(value);
    expect(scanner.location).toBe(location);
  });
