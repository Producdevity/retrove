import { FrameMetricLimit } from "./frame-metrics";

export const GraphicsMetricOperation = { Present: "EAGL presentation" };
const OPERATION_LIMIT = 256;
const SNAPSHOT_LIMIT = 12;
interface Operation {
  calls: number;
  milliseconds: number;
}
export class GraphicsMetrics {
  private current = new Map<string, Operation>();
  private readonly frames: ReadonlyMap<string, Operation>[] = [];
  private readonly totals = new Map<string, Operation>();
  record(name: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const previous = this.current.get(name);
    if (previous) {
      previous.calls++;
      previous.milliseconds += milliseconds;
    } else if (this.current.size < OPERATION_LIMIT)
      this.current.set(name, { calls: 1, milliseconds });
  }
  present(): void {
    for (const [name, operation] of this.current) {
      const previous = this.totals.get(name);
      if (previous) {
        previous.calls += operation.calls;
        previous.milliseconds += operation.milliseconds;
      } else this.totals.set(name, { ...operation });
    }
    this.frames.push(this.current);
    this.current = new Map();
    if (this.frames.length <= FrameMetricLimit.Samples) return;
    const expired = this.frames.shift();
    if (!expired) return;
    for (const [name, operation] of expired) {
      const total = this.totals.get(name);
      if (!total) continue;
      total.calls -= operation.calls;
      total.milliseconds -= operation.milliseconds;
      if (!total.calls) this.totals.delete(name);
    }
  }
  snapshot(): {
    readonly frames: number;
    readonly operations: readonly {
      readonly name: string;
      readonly callsPerFrame: number;
      readonly millisecondsPerFrame: number;
    }[];
  } {
    return {
      frames: this.frames.length,
      operations: [...this.totals]
        .sort((left, right) => right[1].milliseconds - left[1].milliseconds)
        .slice(0, SNAPSHOT_LIMIT)
        .map(([name, operation]) => ({
          name,
          callsPerFrame: operation.calls / this.frames.length,
          millisecondsPerFrame: Math.max(0, operation.milliseconds / this.frames.length),
        })),
    };
  }
}
