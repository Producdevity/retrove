import { describe, expect, it } from "vite-plus/test";
import { LabelAreas } from "./label-areas";
import { arenaRegion } from "./layout";

describe("label areas", () => {
  const region = arenaRegion(0x1_0000, 0x1000);
  it("places executable tables by code offset and foreign tables in a resettable bump area", () => {
    const labels = new LabelAreas(0x100, region);
    const code = { start: 0x2000, end: 0x3000 };
    expect(labels.address({ start: 0x2101, end: 0x2200 }, code)).toBe(
      0x100 + region.labels + 0x200,
    );
    const first = labels.address({ start: 0x8000, end: 0x8010 }, code);
    expect(first).toBe(0x100 + region.foreignLabels);
    expect(labels.address({ start: 0x9000, end: 0x9004 }, code)).toBe(first + 0x20);
    labels.reset();
    expect(labels.address({ start: 0x9000, end: 0x9004 }, code)).toBe(first);
  });
});
