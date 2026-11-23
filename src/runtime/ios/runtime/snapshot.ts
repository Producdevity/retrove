import type { GuestCPU } from "../../cpu/cpu";
import { ExecutionMetricLimit } from "../../diagnostics/execution-metrics";
import { Gauge, gauges } from "../../diagnostics/gauges";
import type { RenderCounts, RunState } from "./run-state";

const HEX = 16;
const LABEL_LENGTH = 192;
const GENERAL_REGISTERS = 13;
const ACTIVE_IMPORTS_SHOWN = 6;
const BYTES_PER_MB = 1e6;
const REGISTER_NAMES: readonly string[] = Array.from(
  { length: GENERAL_REGISTERS },
  (_, i) => "r" + i,
).concat("sp", "lr", "pc");
const MEMORY_GAUGES = [
  Gauge.GuestMappedBytes,
  Gauge.GuestMappedPeak,
  Gauge.WasmMemoryBytes,
  Gauge.TranslatedCodeBytes,
  Gauge.GpuTextureBytes,
  Gauge.GpuBufferBytes,
  Gauge.GpuRenderbufferBytes,
  Gauge.FileCacheBytes,
];

export const hex = (address: number): string => "0x" + address.toString(HEX);
export const label = (value: unknown): string => String(value).slice(0, LABEL_LENGTH);

/** Clear and draw calls, including those the graphics worker's own thread made without settling here. */
export function renderCounts(state: RunState): RenderCounts {
  const { render } = state,
    local = state.parts.remoteGraphics?.localRender;
  return local
    ? {
        ...render,
        clearCalls: render.clearCalls + local.clearCalls,
        drawCalls: render.drawCalls + local.drawCalls,
      }
    : { ...render };
}

function registerValues(cpu: GuestCPU | undefined, full: boolean): Record<string, string> {
  const registers: Record<string, string> = {};
  if (cpu) {
    // A failed Wasm engine can also reject register reads. Keep the rest of the report.
    try {
      for (const [i, name] of REGISTER_NAMES.entries())
        if (full || i >= GENERAL_REGISTERS) registers[name] = hex(cpu.getReg(i));
      registers["cpsr"] = hex(cpu.cpsr);
    } catch {
      /* The last successful CPU reads are still useful. */
    }
  }
  return registers;
}

function cpuDetails(cpu: GuestCPU | undefined) {
  return {
    interpretedMs: Math.round(cpu?.interpretedMilliseconds ?? 0),
    cpuMethod: cpu
      ? (cpu.method ?? (cpu.translation ? "interpreter with translation" : "interpreter"))
      : undefined,
    mappedBytes: cpu?.mappedBytes,
    executionBudget: cpu?.budget,
    compiler: cpu?.compiler,
    translation: cpu?.translation,
  };
}

/** Retrove's own memory accounting in MB; reports from phones that iOS closed for memory need it. */
const memoryMB = () =>
  Object.fromEntries(
    MEMORY_GAUGES.map((gauge) => [gauge, Math.round(gauges.value(gauge) / BYTES_PER_MB)]),
  );

function recentActivity(state: RunState) {
  const { parts, executionMetrics } = state;
  return {
    execution: executionMetrics.snapshot(),
    executionWindow: {
      samples: executionMetrics.sampleCount,
      limit: ExecutionMetricLimit.Samples,
    },
    input: parts.objc?.inputSnapshot(),
    audio: parts.audio?.snapshot(),
    openAL: parts.al?.snapshot(),
    audioPlayers: parts.objc?.audioPlayerSnapshot(),
    topImports: state.importMetrics.snapshot(),
    recentImports: state.recent.slice(),
    missingAssetRequests: state.missingAssetRequests,
    missingAssets: state.missingAssets.slice(),
    recentMissingAssets: state.recentMissingAssets.slice(),
  };
}

/** The run's progress; fault context comes before variable-length lists so it survives a shortened mobile export. */
export function guestSnapshot(state: RunState, full = false) {
  const { parts } = state,
    { cpu, threads } = parts;
  const registers = registerValues(cpu, full);
  return {
    phase: state.phase,
    elapsedMs: Math.round(performance.now() - state.started),
    cpuMs: Math.round(state.guestMilliseconds()),
    ...cpuDetails(cpu),
    calls: state.calls,
    cpuSlices: state.cpuSlices,
    budgetSlices: state.budgetSlices,
    completedInitializers: state.completedInitializers,
    threadId: state.threadId(),
    registers,
    activeImports: state.active
      .filter((call) => call.thread === state.threadId())
      .slice(-ACTIVE_IMPORTS_SHOWN)
      .map((call) => call.name),
    lastSelector: parts.objc?.lastSelector,
    render: renderCounts(state),
    frameTimings: state.frameMetrics.snapshot(),
    graphicsOperations: state.graphicsMetrics.snapshot(),
    heapAllocations: parts.heap?.live.size,
    exitStatus: state.exitStatus,
    memoryMB: memoryMB(),
    memoryTimeline: state.memoryTimeline.rows(),
    threadCpuMs: Object.fromEntries(
      [...state.threadCpuMs].map(([thread, ms]) => [thread, Math.round(ms)]),
    ),
    workerThreads: threads?.remote?.statistics(),
    schedulerTurns: threads?.schedulerTurns(),
    ...recentActivity(state),
    ...state.link,
  };
}
export type GuestSnapshot = ReturnType<typeof guestSnapshot>;
