import { expect, test } from "vite-plus/test";
import { structCopyImports } from "./properties";
test("Objective-C struct copies preserve memmove semantics across chunk boundaries and overlap directions", () => {
  for (const [source, destination, length] of [
    [0, 1, 131077],
    [1, 0, 131077],
    [0, 140000, 1024],
    [32, 32, 128],
    [0, 0, 0],
  ] as const) {
    const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 251),
      expected = bytes.slice();
    expected.copyWithin(destination, source, source + length);
    const copy = structCopyImports({
      readBytes: (p, n) => bytes.slice(p, p + n),
      writeBytes: (p, b) => {
        bytes.set(b, p);
      },
    })._objc_copyStruct;
    if (!copy) throw new Error("Missing struct copy import");
    const words = [destination, source, length, 1, 1];
    copy((index) => words[index] ?? 0);
    expect(bytes).toEqual(expected);
  }
});
test("Objective-C struct copies reject negative sizes without changing destination memory", () => {
  let written = false;
  const copy = structCopyImports({
    readBytes: () => new Uint8Array(),
    writeBytes: () => {
      written = true;
    },
  })._objc_copyStruct;
  if (!copy) throw new Error("Missing struct copy import");
  const args = [16, 32, 0xffffffff, 0, 0];
  expect(() => copy((i) => args[i] ?? 0)).toThrow(/Negative/);
  expect(written).toBe(false);
});
