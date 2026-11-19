import { expect, test } from "vite-plus/test";
import { Gauge, Gauges } from "./gauges";
import { MemoryTimeline } from "./memory-timeline";
import { WasmLifetimes } from "./wasm-lifetimes";

test("rows show live and compiled translation instances and bundle reads", () => {
  const gauge = new Gauges(),
    timeline = new MemoryTimeline(gauge);
  new WasmLifetimes(gauge).track({}, 3_000_000);
  gauge.add(Gauge.GuestMappedBytes, 364_000_000);
  gauge.add(Gauge.BundleReads, 2);
  gauge.add(Gauge.BundleReadBytes, 131_072);
  timeline.sample(5000, 91_000_000);
  expect(timeline.rows()).toEqual([
    "t 5s guest 364 wasmMem 0 code 0 tex 0 buf 0 rb 0 files 0 | inst 1/1 wasm 3/3 flushes 0 | reads 2 0 js 91",
  ]);
});

test("older rows thin out so a long run still fits the report", () => {
  const timeline = new MemoryTimeline(new Gauges());
  for (let second = 1; second <= 200; second++) timeline.sample(second * 1000);
  const rows = timeline.rows();
  expect(rows.length).toBeLessThanOrEqual(38);
  expect(rows.at(-1)).toMatch(/^t 200s /);
  expect(rows.at(-24)).toMatch(/^t 177s /);
  expect(Number(/^t (\d+)s/.exec(rows[0] ?? "")?.[1])).toBe(1);
});
