import { GraphicsMetricOperation } from "../../diagnostics/graphics-metrics";
import type { Diagnostic } from "../package/ipa";
import { captureFault } from "./fault";
import type { RunState } from "./run-state";
import { guestSnapshot, label } from "./snapshot";

const RECENT_MISSING_ASSETS = 10;
const LISTED_MISSING_ASSETS = 10;
const HEARTBEAT_MS = 5000;

/** Chrome's non-standard heap size; Safari has no equivalent. */
function jsHeapBytes(): number | undefined {
  const memory: unknown = Reflect.get(performance, "memory");
  if (typeof memory !== "object" || memory === null) return undefined;
  const used: unknown = Reflect.get(memory, "usedJSHeapSize");
  return typeof used === "number" ? used : undefined;
}

/** Reports the run's progress, milestones, first frames and faults to the host page. */
export class GuestReport {
  constructor(
    readonly state: RunState,
    private readonly report: (snapshot: unknown) => void,
    private readonly diagnostic: Diagnostic,
  ) {}
  snapshot(full = false) {
    return guestSnapshot(this.state, full);
  }
  readonly milestone = (message: string, details?: unknown): void => {
    this.state.phase = message;
    this.report(this.snapshot());
    this.diagnostic("info", "guest", message, details);
  };
  readonly missingAsset = (path: string): void => {
    const { state } = this;
    state.missingAssetRequests++;
    const name = label(path);
    const recent = state.recentMissingAssets,
      previous = recent.indexOf(name);
    if (previous !== -1) recent.splice(previous, 1);
    recent.push(name);
    if (recent.length > RECENT_MISSING_ASSETS) recent.shift();
    if (state.missingAssets.length >= LISTED_MISSING_ASSETS || state.missingAssetSet.has(name))
      return;
    state.missingAssetSet.add(name);
    state.missingAssets.push(name);
  };
  onRender(): void {
    const { state } = this;
    if (state.firstRender) return;
    state.firstRender = true;
    this.report(this.snapshot());
    this.diagnostic("info", "graphics", "First successful guest rendering call", {
      ...state.render,
    });
  }
  readonly captureFault = (error: unknown): void => captureFault(this.state, error, this.report);
  /** An EAGL presentation attempt, from the Objective-C runtime. */
  readonly present = (presented: number, duration = 0): void => {
    const { state } = this,
      remote = state.parts.remoteGraphics;
    state.graphicsMilliseconds += duration;
    state.graphicsMetrics.record(GraphicsMetricOperation.Present, duration);
    if (presented) state.graphicsMetrics.present();
    if (presented)
      state.frameMetrics.present({
        at: performance.now(),
        cpuMs: state.guestMilliseconds(),
        graphicsMs: state.graphicsMilliseconds,
        yieldMs: state.yieldMilliseconds,
        ...(remote ? { workerGraphicsMs: remote.localMs } : {}),
      });
    state.render.presentAttempts++;
    if (presented && ++state.render.presentedFrames === 1) {
      this.report(this.snapshot());
      this.diagnostic("info", "graphics", "First EAGL frame presented");
    }
  };
  /** Also samples asynchronous host waits, when no CPU slice is completing; returns its stop. */
  heartbeat(): () => void {
    const { state } = this;
    const timer = setInterval(() => {
      state.memoryTimeline.sample(performance.now() - state.started, jsHeapBytes());
      if (!state.firstFault) this.report(this.snapshot());
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }
}
