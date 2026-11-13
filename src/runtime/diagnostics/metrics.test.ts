import { expect, test } from "vite-plus/test";
import { ExecutionMetrics, ExecutionMetricLimit } from "./execution-metrics";
import { DropReason, InputMetrics } from "./input-metrics";
test("CPU samples aggregate instruction offsets by function and retain thread identity", () => {
  const metrics = new ExecutionMetrics();
  metrics.sample(2, 0x1004, { name: "work", offset: 4 });
  metrics.sample(2, 0x1008, { name: "work", offset: 8 });
  metrics.sample(3, 0x1008, { name: "work", offset: 8 });
  expect(metrics.snapshot()).toEqual([
    { thread: 2, symbol: "work", address: 0x1000, samples: 2 },
    { thread: 3, symbol: "work", address: 0x1000, samples: 1 },
  ]);
});
test("input diagnostics preserve delivered coordinates and explain rejected touches", () => {
  const metrics = new InputMetrics(),
    point = [10, 20];
  metrics.receive();
  metrics.dispatch("GameView", "pointerdown", point, [20, 310]);
  point[0] = 99;
  metrics.receive();
  metrics.drop(DropReason.NoTarget);
  expect(metrics.snapshot()).toEqual({
    received: 2,
    delivered: 1,
    dropped: { "no-target": 1 },
    recent: [{ target: "GameView", phase: "pointerdown", point: [10, 20], viewPoint: [20, 310] }],
  });
});

test("CPU samples replace startup symbols with the current workload", () => {
  const metrics = new ExecutionMetrics();
  for (let index = 0; index < ExecutionMetricLimit.Samples; index++)
    metrics.sample(2, index, { name: `startup-${index}`, offset: 0 });
  for (let index = 0; index < ExecutionMetricLimit.Samples; index++)
    metrics.sample(3, 0x1234, { name: "gameplay", offset: 4 });
  expect(metrics.sampleCount).toBe(ExecutionMetricLimit.Samples);
  expect(metrics.snapshot()).toEqual([
    { thread: 3, symbol: "gameplay", address: 0x1230, samples: ExecutionMetricLimit.Samples },
  ]);
});
