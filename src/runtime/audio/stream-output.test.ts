import { describe, expect, it } from "vite-plus/test";
import { Lead, OutputLead, StreamResampler } from "./stream-output";

describe("stream output", () => {
  it("joins consecutive buffers without an edge discontinuity", () => {
    const resampler = new StreamResampler(24_000, 48_000, 1);
    const first = resampler.process([Float32Array.from([0, 1, 2, 3])])[0];
    const second = resampler.process([Float32Array.from([4, 5, 6, 7])])[0];
    expect([...(first ?? [])]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect([...(second ?? [])]).toEqual([3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]);
  });
  it("keeps the overall rate when the ratio is fractional", () => {
    const resampler = new StreamResampler(44_100, 48_000, 2);
    let produced = 0;
    for (let i = 0; i < 100; i++)
      produced += resampler.process([new Float32Array(441), new Float32Array(441)])[0]?.length ?? 0;
    expect(Math.abs(produced - 48_000)).toBeLessThanOrEqual(1);
  });
  it("grows the lead after underruns and shrinks it while playback is steady", () => {
    const lead = new OutputLead();
    lead.underrun();
    lead.underrun();
    expect(lead.target).toBeCloseTo(Lead.Minimum * Lead.Growth ** 2);
    for (let i = 0; i < 10; i++) lead.underrun();
    expect(lead.target).toBe(Lead.Maximum);
    lead.settle(60);
    expect(lead.target).toBe(Lead.Minimum);
  });
});
