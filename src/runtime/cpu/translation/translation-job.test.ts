import { describe, expect, it } from "vite-plus/test";
import { CodeMemory, buildJob, runJob } from "./translation-job";
import { stateLayout } from "./layout";

describe("translation jobs", () => {
  it("reads words from the newest snapshot and applies patches", () => {
    const memory = new CodeMemory();
    memory.add({ start: 0x1000, bytes: new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]) });
    expect(memory.word(0x1004)).toBe(2);
    expect(memory.word(0x1006)).toBeUndefined();
    memory.patch(0x1002, new Uint8Array([9, 9, 7, 0]));
    expect(memory.word(0x1000)).toBe(0x09090001);
    expect(memory.word(0x1004)).toBe(7);
  });
  it("lays out a label block per module and translates without live memory", () => {
    const job = buildJob({
      functions: [
        { start: 0x2000, end: 0x2008 },
        { start: 0x2009, end: 0x200e },
      ],
      entries: [],
      pages: [],
      layout: stateLayout(
        0x10000,
        { arena: 0, mask: 0xffff },
        { base: 0x30000, start: 0x2000, end: 0x3000 },
      ),
      stopPC: 1,
      code: { start: 0x2000, end: 0x3000 },
      cacheKey: undefined,
    });
    expect([...job.labels]).toEqual([
      [0x2000, 0],
      [0x2009, 0x10],
    ]);
    // mov r0, #1 ; bx lr
    const code = new Map([
      [0x2000, 0xe3a00001],
      [0x2004, 0xe12fff1e],
    ]);
    const { translation } = runJob({ ...job, functions: job.functions.slice(0, 1) }, (address) =>
      code.get(address),
    );
    expect(WebAssembly.validate(translation.wasm)).toBe(true);
    expect(translation.functions.map((f) => f.labelAddress)).toEqual([0]);
  });
});
