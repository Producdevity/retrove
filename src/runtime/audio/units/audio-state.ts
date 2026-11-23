import type { GuestMemory } from "../../memory/guest-memory";
import type { OutputLead, StreamResampler } from "../stream-output";
import type { WorkletStream } from "../worklet-stream";
import type { AudioContextSource, GuestCall, GuestHeap } from "../guest-host";
import type { GuestArguments } from "../../ios/objc/host";
import { tag } from "../files/audio-file-format";
import type { OutputFormat } from "./audio-stream";

export const AudioStatus = {
  Parameter: -50,
  Rendering: -10863,
  InvalidProperty: -10879,
  BadScope: -10866,
  BadSize: -10851,
  ReadOnlyWhileInitialized: -10849,
  BadElement: -10877,
  BadFormat: -10868,
  NoCallback: -10876,
  Uninitialized: -10867,
  BadFrames: -10874,
  Allocation: -10875,
} as const;
export const SessionStatus = {
  NotInitialized: tag("!ini"),
  Initialized: tag("init"),
  BadProperty: tag("pty?"),
  BadSize: tag("!siz"),
  BadCategory: tag("!cat"),
} as const;

export type AudioImport = (args: GuestArguments) => number | Promise<number>;

export interface UnitResampler {
  engine: StreamResampler;
  channels: number;
  rate: number;
}
export interface OutputUnit {
  raw: Uint8Array;
  format: OutputFormat;
  maximum: number;
  callback: number;
  ref: number;
  work: number;
  frames: number;
  samples: number;
  peak: number;
  underruns: number;
  started: boolean;
  time: number;
  frame: number;
  lead: OutputLead;
  resampler: UnitResampler | null;
  settled: number;
  sources: Set<AudioBufferSourceNode>;
  stream: WorkletStream | null;
}
export interface Session {
  ready: boolean;
  active: boolean;
  rate: number;
  duration: number;
  category: number;
  mix: number;
  duck: number;
  interruptionCallback: number;
  ref: number;
}
export interface AudioRuntime {
  cpu: GuestMemory;
  heap: GuestHeap;
  callGuest: GuestCall;
  getAudioContext: AudioContextSource;
  units: Map<number, OutputUnit>;
  session: Session;
  rendering: boolean;
  context: AudioContext | undefined;
}

export function stopSources(unit: OutputUnit): void {
  unit.started = false;
  for (const node of unit.sources) {
    node.onended = null;
    node.stop();
    node.disconnect();
  }
  unit.sources.clear();
  unit.stream?.close();
  unit.stream = null;
}

export function release(runtime: AudioRuntime, unit: OutputUnit): void {
  stopSources(unit);
  if (unit.work !== 0) runtime.heap.free(unit.work);
  unit.work = 0;
}

export function withUnit(
  runtime: AudioRuntime,
  args: GuestArguments,
  action: (unit: OutputUnit) => number,
): number {
  if (runtime.rendering) return AudioStatus.Rendering;
  const unit = runtime.units.get(args(0));
  return unit ? action(unit) : AudioStatus.Parameter;
}
