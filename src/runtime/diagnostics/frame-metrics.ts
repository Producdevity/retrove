export const FrameMetricLimit = { Samples: 120, TargetFps: 30 };
const MILLISECONDS_PER_SECOND = 1000;
const MEDIAN = 0.5;
const HIGH_PERCENTILE = 0.95;
interface Counters {
  readonly at: number;
  readonly cpuMs: number;
  readonly graphicsMs: number;
}
interface Sample {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly graphicsMs: number;
  readonly otherMs: number;
}
interface Distribution {
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly maximum: number;
}
function distribution(values: number[]): Distribution {
  values.sort((left, right) => left - right);
  const percentile = (fraction: number): number =>
    values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(MEDIAN),
    p95: percentile(HIGH_PERCENTILE),
    maximum: values.at(-1) ?? 0,
  };
}
export class FrameMetrics {
  private previous: Counters | undefined;
  private readonly samples: Sample[] = [];
  present(counters: Counters): void {
    if (!Object.values(counters).every((value) => Number.isFinite(value) && value >= 0)) return;
    const previous = this.previous;
    this.previous = { ...counters };
    if (!previous) return;
    const frameMs = counters.at - previous.at;
    const cpuMs = counters.cpuMs - previous.cpuMs;
    const graphicsMs = counters.graphicsMs - previous.graphicsMs;
    if (frameMs < 0 || cpuMs < 0 || graphicsMs < 0) {
      this.samples.length = 0;
      return;
    }
    if (!frameMs) return;
    this.samples.push({
      frameMs,
      cpuMs,
      graphicsMs,
      otherMs: Math.max(0, frameMs - cpuMs - graphicsMs),
    });
    if (this.samples.length > FrameMetricLimit.Samples) this.samples.shift();
  }
  snapshot():
    | {
        readonly frames: number;
        readonly durationMs: number;
        readonly fps: number;
        readonly withinBudget: number;
        readonly frameMs: Distribution;
        readonly guestCpuMs: Distribution;
        readonly graphicsImportMs: Distribution;
        readonly otherMs: Distribution;
      }
    | undefined {
    if (!this.samples.length) return undefined;
    const durationMs = this.samples.reduce((sum, sample) => sum + sample.frameMs, 0);
    const budget = MILLISECONDS_PER_SECOND / FrameMetricLimit.TargetFps;
    return {
      frames: this.samples.length,
      durationMs,
      fps: (this.samples.length * MILLISECONDS_PER_SECOND) / durationMs,
      withinBudget: this.samples.filter((sample) => sample.frameMs <= budget).length,
      frameMs: distribution(this.samples.map((sample) => sample.frameMs)),
      guestCpuMs: distribution(this.samples.map((sample) => sample.cpuMs)),
      graphicsImportMs: distribution(this.samples.map((sample) => sample.graphicsMs)),
      otherMs: distribution(this.samples.map((sample) => sample.otherMs)),
    };
  }
}
