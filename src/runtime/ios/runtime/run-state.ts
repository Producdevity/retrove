import type { audioImports } from "../../audio/units/audio";
import type { openAL } from "../../audio/openal/imports";
import type { GuestCPU } from "../../cpu/cpu";
import { ExecutionMetrics } from "../../diagnostics/execution-metrics";
import { FrameMetrics } from "../../diagnostics/frame-metrics";
import { Gauge, gauges } from "../../diagnostics/gauges";
import { GraphicsMetrics } from "../../diagnostics/graphics-metrics";
import { ImportMetrics } from "../../diagnostics/import-metrics";
import { MemoryTimeline } from "../../diagnostics/memory-timeline";
import type { RemoteGraphics } from "../../graphics/remote/remote-graphics";
import type { Heap } from "../../memory/guest-memory";
import type { MachOImage } from "../macho/macho";
import type { ObjcRuntime } from "../objc/runtime-api";
import type { GuestThreads } from "../threads/threads";
import type { FaultReport } from "./fault";

/** The runtime pieces diagnostics read; each is set once the runtime has built it. */
export interface GuestParts {
  cpu?: GuestCPU;
  heap?: Heap;
  threads?: GuestThreads;
  audio?: ReturnType<typeof audioImports>;
  al?: ReturnType<typeof openAL>;
  objc?: ObjcRuntime;
  image?: MachOImage;
  remoteGraphics?: RemoteGraphics | undefined;
}
export interface RenderCounts {
  clearCalls: number;
  drawCalls: number;
  presentAttempts: number;
  presentedFrames: number;
}
/** What the guest linked against; filled in as linking proceeds. */
export interface LinkSummary {
  readonly entry?: number;
  readonly imports?: number;
  readonly executableBytes?: number;
  readonly segmentCount?: number;
  readonly dylibCount?: number;
  readonly initializers?: number;
  readonly unsupportedCount?: number;
  readonly unsupported?: readonly string[];
  readonly unimplementedClasses?: number;
  readonly unimplementedSelectors?: number;
}
export interface ActiveImport {
  readonly name: string;
  readonly thread: number;
}

/** Counters, metrics and recent activity of one guest run, for reports and fault captures. */
export class RunState {
  readonly started = performance.now();
  readonly parts: GuestParts = {};
  phase = "Read executable";
  calls = 0;
  cpuSlices = 0;
  budgetSlices = 0;
  completedInitializers = 0;
  link: LinkSummary = {};
  exitStatus: number | undefined;
  firstFault: FaultReport | undefined;
  firstRender = false;
  readonly render: RenderCounts = {
    clearCalls: 0,
    drawCalls: 0,
    presentAttempts: 0,
    presentedFrames: 0,
  };
  readonly importMetrics = new ImportMetrics();
  readonly executionMetrics = new ExecutionMetrics();
  readonly frameMetrics = new FrameMetrics();
  readonly memoryTimeline = new MemoryTimeline();
  readonly graphicsMetrics = new GraphicsMetrics();
  readonly threadCpuMs = new Map<number, number>();
  graphicsMilliseconds = 0;
  yieldMilliseconds = 0;
  // Host imports that translated code ran in place are inside the CPU's run time; guest time excludes them.
  inPlaceMilliseconds = 0;
  readonly recent: string[] = [];
  readonly active: ActiveImport[] = [];
  /** Unmapped pages standing in for unresolved eager imports. */
  readonly deferred = new Map<string, number>();
  readonly lastCall = { gate: 0, lr: 0, thread: 0 };
  readonly missingAssets: string[] = [];
  readonly missingAssetSet = new Set<string>();
  readonly recentMissingAssets: string[] = [];
  missingAssetRequests = 0;
  constructor() {
    gauges.read(Gauge.PresentedFrames, () => this.render.presentedFrames);
  }
  guestMilliseconds(): number {
    return (this.parts.cpu?.executedMilliseconds ?? 0) - this.inPlaceMilliseconds;
  }
  /** The current guest thread, once the thread imports exist. */
  threadId(): number | undefined {
    return this.parts.threads?.funcs._pthread_self();
  }
}
