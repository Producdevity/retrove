import { describe, expect, it } from "vite-plus/test";
import { functionAt, functionStarts } from "./executable";
import { calleeStarts } from "./callees";

describe("executable functions", () => {
  it("decodes ULEB128 function start deltas inside __text", () => {
    // header 0x1000; deltas 0x1000 -> 0x2000, 0x81 -> 0x2081 (Thumb), 0x7f -> 0x2100
    const bytes = new Uint8Array([0x80, 0x20, 0x81, 0x01, 0x7f, 0x00, 0x10]);
    expect(functionStarts(bytes, 0x1000, { start: 0x2000, end: 0x3000 })).toEqual([
      0x2000, 0x2081, 0x2100,
    ]);
  });
  it("finds the function for a PC and respects ARM/Thumb state", () => {
    const executable = {
      codeStart: 0x2000,
      codeEnd: 0x3000,
      ranges: [
        { start: 0x2000, end: 0x2080 },
        { start: 0x2081, end: 0x2100 },
        { start: 0x2100, end: 0x3000 },
      ],
    };
    expect(functionAt(executable, 0x2004)).toEqual({ start: 0x2000, end: 0x2080 });
    expect(functionAt(executable, 0x2091)).toEqual({ start: 0x2081, end: 0x2100 });
    expect(functionAt(executable, 0x2090)).toBeUndefined();
    expect(functionAt(executable, 0x3000)).toBeUndefined();
    expect(functionAt(undefined, 0x2000)).toBeUndefined();
  });
  it("lists direct BL targets and skips BLX immediates", () => {
    const words = new Map([
      [0x2000, 0xeb000002], // bl 0x2010
      [0x2004, 0xfa000002], // blx 0x2014
      [0x2008, 0xebfffffc], // bl 0x2000
    ]);
    expect(calleeStarts({ start: 0x2000, end: 0x200c }, (address) => words.get(address))).toEqual([
      0x2010, 0x2000,
    ]);
  });
});
