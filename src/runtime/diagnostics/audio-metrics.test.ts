import { expect, test } from "vite-plus/test";
import { AudioMetrics } from "./audio-metrics";
test("audio diagnostics preserve synchronous and asynchronous results and argument snapshots", async () => {
  const metrics = new AudioMetrics();
  const imports = metrics.track({
    _AudioComponentFindNext: () => 42,
    success: () => 0,
    failure: () => Promise.resolve(-50),
  });
  const args = [1, 2, 3];
  expect(imports._AudioComponentFindNext?.((index) => args[index] ?? 0)).toBe(42);
  expect(imports.success?.(() => 0)).toBe(0);
  const pending = imports.failure?.((index) => args[index] ?? 0);
  args[0] = 99;
  expect(await pending).toBe(-50);
  expect(metrics.snapshot().failures).toEqual([
    { operation: "failure", status: -50, arguments: [1, 2, 3, 0] },
  ]);
  expect(metrics.snapshot().calls).toEqual({ _AudioComponentFindNext: 1, success: 1, failure: 1 });
  const snapshot = metrics.snapshot();
  snapshot.failures[0]?.arguments.fill(0);
  expect(metrics.snapshot().failures[0]?.arguments[0]).toBe(1);
});
