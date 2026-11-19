import { describe, expect, it } from "vite-plus/test";
import { AheadOfTime, AotChunk, aotChunks } from "./aot";
import type { Executable } from "./executable";

const executable = (count: number, size: number): Executable => ({
  codeStart: 0x1000,
  codeEnd: 0x1000 + count * size,
  ranges: Array.from({ length: count }, (_, index) => ({
    start: 0x1000 + index * size,
    end: 0x1000 + (index + 1) * size,
  })),
});

describe("ahead-of-time chunks", () => {
  it("splits by function count and instruction count in address order", () => {
    const chunks = aotChunks(executable(AotChunk.functions + 1, 8));
    expect(chunks.map((chunk) => chunk.length)).toEqual([AotChunk.functions, 1]);
    const large = aotChunks(executable(3, AotChunk.instructions * 4));
    expect(large.map((chunk) => chunk.length)).toEqual([1, 1, 1]);
  });
  it("queues a chunk once, prepares all in the background and lets loaded ones translate alone", async () => {
    const prepared: string[] = [];
    const job = (_: unknown, key: string): string => {
      prepared.push(key);
      return key;
    };
    const aot = new AheadOfTime<string>(executable(AotChunk.functions * 2, 8), "app", {
      job,
      prepare: (key) => Promise.resolve(key !== "app/aot1"),
      busy: () => false,
      closed: () => false,
      progress: () => undefined,
    });
    await aot.start();
    expect(prepared).toEqual(["app/aot0", "app/aot1"]);
    expect([aot.prepared, aot.chunks]).toEqual([1, 2]);
    expect(aot.request(0x1008)).toBe(true);
    expect(aot.request(0x1010)).toBe(true);
    expect(aot.waiting).toBe(1);
    expect(aot.take()).toBe("app/aot0");
    expect(aot.request(0x1000)).toBe(false);
    expect(aot.request(0x1000 + AotChunk.functions * 8)).toBe(true);
    aot.suspend();
    expect([aot.request(0x1000), aot.waiting]).toEqual([false, 0]);
  });
});
