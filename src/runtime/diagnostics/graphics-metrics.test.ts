import { expect, test } from "vite-plus/test";
import { FrameMetricLimit } from "./frame-metrics";
import { GraphicsMetrics } from "./graphics-metrics";

test("graphics costs exclude unfinished frames and expire shader warmup", () => {
  const metrics = new GraphicsMetrics();
  metrics.record("compile", 2000);
  metrics.present();
  for (let frame = 0; frame < FrameMetricLimit.Samples; frame++) {
    metrics.record("draw", 3);
    metrics.record("draw", 4);
    metrics.record("upload", 1);
    metrics.present();
  }
  metrics.record("unfinished", 999);
  expect(metrics.snapshot()).toEqual({
    frames: FrameMetricLimit.Samples,
    operations: [
      { name: "draw", callsPerFrame: 2, millisecondsPerFrame: 7 },
      { name: "upload", callsPerFrame: 1, millisecondsPerFrame: 1 },
    ],
  });
});

test("empty frames contribute to averages and invalid durations are ignored", () => {
  const metrics = new GraphicsMetrics();
  expect(metrics.snapshot()).toEqual({ frames: 0, operations: [] });
  metrics.record("invalid", NaN);
  metrics.record("invalid", Infinity);
  metrics.record("invalid", -1);
  metrics.record("draw", 8);
  metrics.present();
  metrics.present();
  expect(metrics.snapshot()).toEqual({
    frames: 2,
    operations: [{ name: "draw", callsPerFrame: 0.5, millisecondsPerFrame: 4 }],
  });
});
