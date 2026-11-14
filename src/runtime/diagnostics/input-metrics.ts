export type TouchPhase = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
export const DropReason = {
  NoTarget: "no-target",
  Occupied: "single-touch-view",
  Exclusive: "exclusive-touch-view",
  Missing: "missing-touch",
  Duplicate: "duplicate-down",
  Inactive: "inactive-application",
} as const;
type DropReason = (typeof DropReason)[keyof typeof DropReason];
interface Dispatch {
  readonly target: string;
  readonly phase: TouchPhase;
  readonly point: readonly number[];
  readonly viewPoint: readonly number[];
}
const HISTORY_LIMIT = 8;
export class InputMetrics {
  private received = 0;
  private delivered = 0;
  private readonly dropped = new Map<DropReason, number>();
  private readonly recent: Dispatch[] = [];
  receive(): void {
    this.received++;
  }
  drop(reason: DropReason): void {
    this.dropped.set(reason, (this.dropped.get(reason) ?? 0) + 1);
  }
  dispatch(
    target: string,
    phase: TouchPhase,
    point: readonly number[],
    viewPoint: readonly number[] = point,
  ): void {
    this.delivered++;
    this.recent.push({ target, phase, point: [...point], viewPoint: [...viewPoint] });
    if (this.recent.length > HISTORY_LIMIT) this.recent.shift();
  }
  snapshot() {
    return {
      received: this.received,
      delivered: this.delivered,
      dropped: Object.fromEntries(this.dropped),
      recent: this.recent.map((item) => ({
        ...item,
        point: [...item.point],
        viewPoint: [...item.viewPoint],
      })),
    };
  }
}
