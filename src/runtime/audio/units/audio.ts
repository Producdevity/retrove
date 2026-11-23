import type { GuestMemory } from "../../memory/guest-memory";
import { read32, write32 } from "../../memory/guest-memory";
import { AudioMetrics } from "../../diagnostics/audio-metrics";
import type { AudioContextSource, GuestCall, GuestHeap } from "../guest-host";
import { tag } from "../files/audio-file-format";
import { OutputLead } from "../stream-output";
import { preloadStreamWorklet } from "../worklet-stream";
import { pumpUnits, WORK_HEADER_BYTES } from "./audio-render";
import { audioSession, newSession, setSessionActive } from "./audio-session";
import { AudioStatus, release, stopSources, withUnit } from "./audio-state";
import type { AudioImport, AudioRuntime, OutputUnit } from "./audio-state";
import { defaultStream, parseStream, RIOC } from "./audio-stream";
import { unitProperty } from "./audio-unit-properties";

const AUDIO_UNIT_TYPE = tag("auou");
const APPLE_MANUFACTURER = tag("appl");
const DEFAULT_MAXIMUM_FRAMES = 4096;
const MIN_FRAMES = 64;
const COMPONENT_WORDS = 3;
const WORD_BYTES = 4;
const Component = { Flags: 12, FlagsMask: 16 } as const;
const Render = { Flags: 1, Stamp: 2, Bus: 3, Frames: 4, List: 5 } as const;

function findComponent(runtime: AudioRuntime, args: (index: number) => number): number {
  if (args(0) || !args(1)) return 0;
  const description = args(1);
  const expected = [AUDIO_UNIT_TYPE, RIOC, APPLE_MANUFACTURER];
  for (let index = 0; index < COMPONENT_WORDS; index++) {
    const value = read32(runtime.cpu, description + WORD_BYTES * index);
    if (value && value !== expected[index]) return 0;
  }
  return read32(runtime.cpu, description + Component.Flags) &
    read32(runtime.cpu, description + Component.FlagsMask)
    ? 0
    : RIOC;
}

function newUnit(): OutputUnit {
  const raw = defaultStream(),
    format = parseStream(raw);
  if (!format) throw new Error("Invalid default RemoteIO stream format");
  return {
    raw,
    format,
    maximum: DEFAULT_MAXIMUM_FRAMES,
    callback: 0,
    ref: 0,
    work: 0,
    frames: 0,
    samples: 0,
    peak: 0,
    underruns: 0,
    started: false,
    time: 0,
    frame: 0,
    lead: new OutputLead(),
    resampler: null,
    settled: 0,
    sources: new Set(),
    stream: null,
  };
}

function initialize(runtime: AudioRuntime, unit: OutputUnit): number {
  if (unit.work) return 0;
  if (!unit.callback) return AudioStatus.NoCallback;
  runtime.context ??= runtime.getAudioContext() ?? undefined;
  const { context } = runtime;
  if (!context || context.state === "closed") return AudioStatus.Allocation;
  preloadStreamWorklet(context);
  const wanted = Math.min(unit.maximum, Math.round(runtime.session.duration * unit.format.rate));
  let frames = MIN_FRAMES;
  while (frames < wanted && frames << 1 <= unit.maximum) frames <<= 1;
  unit.frames = frames;
  unit.samples = 0;
  // flags + padding, AudioTimeStamp, AudioBufferList, interleaved PCM.
  unit.work = runtime.heap.alloc(WORK_HEADER_BYTES + frames * unit.format.frameBytes);
  return unit.work ? 0 : AudioStatus.Allocation;
}

async function renderUnit(runtime: AudioRuntime, args: (index: number) => number): Promise<number> {
  const unit = runtime.units.get(args(0)),
    flags = args(Render.Flags),
    stamp = args(Render.Stamp),
    list = args(Render.List);
  if (!unit || !flags || !stamp || !list) return AudioStatus.Parameter;
  if (!unit.work) return AudioStatus.Uninitialized;
  if (args(Render.Bus) !== 0 || !unit.callback) return AudioStatus.NoCallback;
  if (args(Render.Frames) > unit.maximum) return AudioStatus.BadFrames;
  if (runtime.rendering) return AudioStatus.Rendering;
  runtime.rendering = true;
  try {
    return Number(
      await runtime.callGuest(unit.callback, [
        unit.ref,
        flags,
        stamp,
        args(Render.Bus),
        args(Render.Frames),
        list,
      ]),
    );
  } finally {
    runtime.rendering = false;
  }
}

function unitImports(runtime: AudioRuntime): Record<string, AudioImport> {
  const { cpu, units } = runtime;
  let next = 1;
  return {
    _AudioComponentFindNext: (args) => findComponent(runtime, args),
    _AudioComponentInstanceNew: (args) => {
      if (runtime.rendering) return AudioStatus.Rendering;
      if (args(0) !== RIOC || !args(1)) return AudioStatus.Parameter;
      const id = next++;
      units.set(id, newUnit());
      write32(cpu, args(1), id);
      return 0;
    },
    _AudioUnitSetProperty: (args) => unitProperty(runtime, args, true),
    _AudioUnitGetProperty: (args) => unitProperty(runtime, args, false),
    _AudioUnitInitialize: (args) => withUnit(runtime, args, (unit) => initialize(runtime, unit)),
    _AudioUnitRender: (args) => renderUnit(runtime, args),
    _AudioOutputUnitStart: (args) =>
      withUnit(runtime, args, (unit) => {
        if (!unit.work) return AudioStatus.Uninitialized;
        if (!unit.started) {
          unit.time = 0;
          unit.frame = 0;
        }
        unit.started = true;
        return 0;
      }),
    _AudioOutputUnitStop: (args) =>
      withUnit(runtime, args, (unit) => {
        stopSources(unit);
        return 0;
      }),
    _AudioUnitUninitialize: (args) =>
      withUnit(runtime, args, (unit) => {
        release(runtime, unit);
        return 0;
      }),
    _AudioComponentInstanceDispose: (args) =>
      withUnit(runtime, args, (unit) => {
        release(runtime, unit);
        units.delete(args(0));
        return 0;
      }),
  };
}

export function audioImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  callGuest: GuestCall,
  getAudioContext: AudioContextSource,
) {
  const runtime: AudioRuntime = {
    cpu,
    heap,
    callGuest,
    getAudioContext,
    units: new Map(),
    session: newSession(),
    rendering: false,
    context: undefined,
  };
  const metrics = new AudioMetrics(),
    session = audioSession(runtime);
  const funcs = metrics.track({ ...unitImports(runtime), ...session.funcs });
  return {
    funcs,
    pump: () => pumpUnits(runtime),
    pumpSession: (objc: Parameters<typeof session.pump>[0]) => session.pump(objc),
    close(): void {
      session.close();
      for (const unit of runtime.units.values()) release(runtime, unit);
      runtime.units.clear();
    },
    setSessionActive: (enabled: boolean) => setSessionActive(runtime, enabled),
    snapshot: () => ({
      context: runtime.context?.state,
      ready: runtime.session.ready,
      active: runtime.session.active,
      api: metrics.snapshot(),
      units: [...runtime.units.values()].map((unit) => ({
        started: unit.started,
        rate: unit.format.rate,
        channels: unit.format.channels,
        frames: unit.frames,
        samples: unit.samples,
        peak: unit.peak,
        underruns: unit.underruns,
        queuedSources: unit.sources.size,
      })),
    }),
  };
}
