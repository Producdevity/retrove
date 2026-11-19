import { describe, expect, it } from "vite-plus/test";
import { codeRangeAt, demandAt, DEMAND_WINDOW_BYTES } from "./code-range";
import { PageEntries } from "./foreign-pages";
import { ProfileRecorder } from "./translation-profile";

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
  it("translates very large functions in windows from the entry", () => {
    const large = {
      codeStart: 0x1000,
      codeEnd: 0x100000,
      ranges: [{ start: 0x1000, end: 0x100000 }],
    };
    const demand = demandAt(
      0x8000,
      large,
      new ProfileRecorder(undefined),
      new PageEntries(() => []),
    );
    expect(demand?.function).toEqual({ start: 0x8000, end: 0x8000 + DEMAND_WINDOW_BYTES });
    expect(demand?.entries).toEqual([0x8000]);
  });
});
