import { expect, test } from "vite-plus/test";
import { ExecutionMetrics } from "./execution-metrics";
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
