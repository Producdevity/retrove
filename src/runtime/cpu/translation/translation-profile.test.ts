import { describe, expect, it } from "vite-plus/test";
import { collectBatch } from "./collect";
import { readRanges, readValues } from "./module-cache";
import {
  MAX_EXTRA_ENTRIES,
  ProfileRecorder,
  decodeProfile,
  profileBatches,
} from "./translation-profile";

const executable = {
  codeStart: 0x2000,
  codeEnd: 0x3000,
  ranges: [
    { start: 0x2000, end: 0x2100 },
    { start: 0x2101, end: 0x2200 },
    { start: 0x2200, end: 0x2400 },
    { start: 0x2400, end: 0x3000 },
  ],
};

describe("translation profiles", () => {
  it("rejects malformed stored profiles", () => {
    expect(decodeProfile({ functions: [0x2000], entries: [[0x2000, [0x2010]]] })).toEqual({
      functions: [0x2000],
      entries: [[0x2000, [0x2010]]],
    });
    expect(decodeProfile({ functions: ["0x2000"], entries: [] })).toBeUndefined();
    expect(decodeProfile({ functions: [], entries: [[0x2000, 1]] })).toBeUndefined();
    expect(decodeProfile(undefined)).toBeUndefined();
  });
  it("replays functions in first-translated order and splits at the limits", () => {
    const profile = { functions: [0x2200, 0x2101, 0x2050, 0x2000, 0x2200, 0x2400], entries: [] };
    const batches = profileBatches(profile, executable, { instructions: 160, functions: 8 });
    expect(batches.map((batch) => batch.map((range) => range.start))).toEqual([
      [0x2200, 0x2101],
      [0x2000, 0x2400],
    ]);
  });
  it("records new functions and entries once and reports changes", () => {
    const recorder = new ProfileRecorder({ functions: [0x2000], entries: [] });
    recorder.record(0x2000);
    expect(recorder.take()).toBeUndefined();
    recorder.record(0x2200);
    expect(recorder.addEntry(0x2200, 0x2210)).toBe(true);
    expect(recorder.addEntry(0x2200, 0x2210)).toBe(false);
    expect(recorder.take()).toEqual({ functions: [0x2000, 0x2200], entries: [[0x2200, [0x2210]]] });
    expect(recorder.take()).toBeUndefined();
    for (let entry = 0; entry <= MAX_EXTRA_ENTRIES; entry++) recorder.addEntry(0x2400, entry);
    expect(recorder.addEntry(0x2400, 0x2f00)).toBe(false);
  });
});

describe("translation batches", () => {
  it("drops queued functions that were translated meanwhile", () => {
    const queued = new Set([0x2000, 0x2200, 0x2101]);
    const ranges = collectBatch({
      queued,
      executable,
      handled: (start) => start === 0x2200,
      readWord: () => 0,
      limits: { instructions: 1000, functions: 10 },
    });
    expect(ranges.map((range) => range.start)).toEqual([0x2000, 0x2101]);
    expect(queued.size).toBe(0);
  });
});

describe("module cache reads", () => {
  it("merges nearby reads and replays them in order", () => {
    const ranges = readRanges([0x2008, 0x2000, 0x2004, 0x2100, 0x2102, 0x2201]);
    expect([...ranges]).toEqual([0x2000, 0x200a, 0x2100, 0x2104, 0x2201, 0x2203]);
    const values = readValues(ranges, (address) => address);
    expect(values && [...values]).toEqual([
      0x2000, 0x2002, 0x2004, 0x2006, 0x2008, 0x2100, 0x2102, 0x2201,
    ]);
    expect(readValues(ranges, (address) => (address === 0x2102 ? undefined : 0))).toBeUndefined();
  });
});
