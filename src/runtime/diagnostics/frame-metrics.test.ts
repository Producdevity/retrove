import { expect, test } from "vite-plus/test";
import { FrameMetricLimit, FrameMetrics } from "./frame-metrics";
test("frame measurements exclude startup and separate guest CPU from graphics and other time", () => {
  const metrics = new FrameMetrics();
  metrics.present({ at: 10000, cpuMs: 5000, graphicsMs: 200, yieldMs: 50 });
  expect(metrics.snapshot()).toBeUndefined();
  metrics.present({ at: 10016, cpuMs: 5005, graphicsMs: 201, yieldMs: 53 });
  metrics.present({ at: 10036, cpuMs: 5011, graphicsMs: 203, yieldMs: 57 });
  metrics.present({ at: 10076, cpuMs: 5019, graphicsMs: 206, yieldMs: 65 });
  expect(metrics.snapshot()).toEqual({
    frames: 3,
    durationMs: 76,
    fps: 3000 / 76,
    withinBudget: 2,
    frameMs: { mean: 76 / 3, median: 20, p95: 40, maximum: 40 },
    guestCpuMs: { mean: 19 / 3, median: 6, p95: 8, maximum: 8 },
    graphicsImportMs: { mean: 2, median: 2, p95: 3, maximum: 3 },
    yieldWaitMs: { mean: 5, median: 4, p95: 8, maximum: 8 },
    otherMs: { mean: 12, median: 8, p95: 21, maximum: 21 },
  });
});
test("frame history is bounded and resets when its cumulative counters restart", () => {
  const metrics = new FrameMetrics();
  metrics.present({ at: 0, cpuMs: 0, graphicsMs: 0, yieldMs: 0 });
  metrics.present({ at: 1000, cpuMs: 900, graphicsMs: 50, yieldMs: 0 });
  for (let index = 1; index <= FrameMetricLimit.Samples; index++)
    metrics.present({
      at: 1000 + index * 20,
      cpuMs: 900 + index * 10,
      graphicsMs: 50 + index,
      yieldMs: 0,
    });
  expect(metrics.snapshot()).toMatchObject({
    frames: 120,
    durationMs: 2400,
    fps: 50,
    withinBudget: 120,
  });
  metrics.present({ at: 0, cpuMs: 0, graphicsMs: 0, yieldMs: 0 });
  expect(metrics.snapshot()).toBeUndefined();
  metrics.present({ at: NaN, cpuMs: 0, graphicsMs: 0, yieldMs: 0 });
  metrics.present({ at: 20, cpuMs: 10, graphicsMs: 1, yieldMs: 0 });
  expect(metrics.snapshot()).toMatchObject({ frames: 1, fps: 50 });
});
