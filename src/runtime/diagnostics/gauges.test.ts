import { describe, expect, it } from "vite-plus/test";
import { Gauge, Gauges } from "./gauges";

describe("runtime gauges", () => {
  it("accumulates counters and prefers readers", () => {
    const gauges = new Gauges();
    gauges.add(Gauge.GpuTextureBytes, 100);
    gauges.add(Gauge.GpuTextureBytes, -40);
    expect(gauges.value(Gauge.GpuTextureBytes)).toBe(60);
    gauges.read(Gauge.WasmMemoryBytes, () => 512);
    expect(gauges.value(Gauge.WasmMemoryBytes)).toBe(512);
    expect(gauges.value(Gauge.FileCacheBytes)).toBe(0);
  });
  it("reports zero for a reader that fails or returns a non-number", () => {
    const gauges = new Gauges();
    gauges.read(Gauge.GuestCpuMs, () => Number.NaN);
    gauges.read(Gauge.GuestThreads, () => {
      throw new Error("closed");
    });
    expect([gauges.value(Gauge.GuestCpuMs), gauges.value(Gauge.GuestThreads)]).toEqual([0, 0]);
  });
});
