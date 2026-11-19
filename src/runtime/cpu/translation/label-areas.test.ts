import { describe, expect, it } from "vite-plus/test";
import { LabelAreas } from "./label-areas";
import { arenaRegion } from "./layout";

describe("label areas", () => {
  const region = arenaRegion(0x1_0000, 0x1000);
  it("hands out disjoint blocks until full and starts over after a reset", () => {
    const labels = new LabelAreas(0x100, region);
    const first = labels.allocate(0x40);
    expect(first).toBe(0x100 + region.labels);
    expect(labels.allocate(0x20)).toBe(0x100 + region.labels + 0x40);
    expect(labels.crowded).toBe(false);
    expect(labels.allocate(region.bytes)).toBeUndefined();
    labels.allocate((region.bytes - region.labels) / 2);
    expect(labels.crowded).toBe(true);
    labels.reset();
    expect(labels.allocate(0x10)).toBe(first);
  });
});
