import { describe, expect, it } from "vite-plus/test";
import { codeRangeAt } from "./code-range";

describe("code ranges", () => {
  const executable = {
    codeStart: 0x1000,
    codeEnd: 0x9000,
    ranges: [
      { start: 0x1000, end: 0x1100 },
      { start: 0x2001, end: 0x2100 },
    ],
  };
  it("prefers the listed function and keeps its instruction set", () => {
    expect(codeRangeAt(executable, 0x1010)).toEqual({ start: 0x1000, end: 0x1100 });
    expect(codeRangeAt(executable, 0x2011)).toEqual({ start: 0x2001, end: 0x2100 });
  });
  it("runs unlisted code up to the next function or a page", () => {
    expect(codeRangeAt(executable, 0x1201)).toEqual({ start: 0x1201, end: 0x2000 });
    expect(codeRangeAt(executable, 0x3000)).toEqual({ start: 0x3000, end: 0x4000 });
    expect(codeRangeAt(executable, 0xa000)).toBeUndefined();
  });
});
