import { read32, write32 } from "../../memory/guest-memory";
import { StreamResampler } from "../stream-output";
import { WorkletStream } from "../worklet-stream";
import type { AudioRuntime, OutputUnit } from "./audio-state";
import { streamView } from "./audio-stream";

const Work = { Flags: 0, Timestamp: 8, List: 72, Pcm: 88 } as const;
const List = { Count: 0, Channels: 4, Length: 8, Data: 12 } as const;
const Stamp = { Bytes: 64, Host: 8, Flags: 56 } as const;
const STAMP_FLAGS = 3;
const SILENCE_FLAG = 16;
const NANOSECONDS_PER_MILLISECOND = 1e6;
const UNSIGNED_BYTE_SILENCE = 128;
const UNSIGNED_SHORT_SILENCE = 32768;
const SHORT_BYTES = 2;
const RENDER_SLACK = 0.005;
const MAX_BURSTS = 12;

export const WORK_HEADER_BYTES = Work.Pcm;

function ownedChannels(channels: Float32Array[]): Float32Array<ArrayBuffer>[] {
  const owned = (channel: Float32Array): channel is Float32Array<ArrayBuffer> =>
    channel.buffer instanceof ArrayBuffer;
  return channels.every(owned) ? channels : channels.map((channel) => channel.slice());
}

function silenceFor(unit: OutputUnit, length: number): Uint8Array {
  const silence = new Uint8Array(length),
    { format } = unit;
  if (!format.float && !format.signed) {
    if (format.width === 1) silence.fill(UNSIGNED_BYTE_SILENCE);
    else {
      const quiet = streamView(silence);
      for (let index = 0; index < length; index += SHORT_BYTES)
        quiet.setUint16(index, UNSIGNED_SHORT_SILENCE, format.little);
    }
  }
  return silence;
}

function prepareBuffers(runtime: AudioRuntime, unit: OutputUnit, length: number): void {
  const { cpu } = runtime,
    { work, format } = unit;
  const timestamp = work + Work.Timestamp,
    list = work + Work.List,
    pcm = work + Work.Pcm;
  const stamp = new Uint8Array(Stamp.Bytes),
    view = streamView(stamp);
  view.setFloat64(0, unit.samples, true);
  view.setBigUint64(
    Stamp.Host,
    BigInt(Math.floor(performance.now() * NANOSECONDS_PER_MILLISECOND)),
    true,
  );
  view.setUint32(Stamp.Flags, STAMP_FLAGS, true);
  cpu.write(timestamp, stamp);
  write32(cpu, work + Work.Flags, 0);
  write32(cpu, list + List.Count, 1);
  write32(cpu, list + List.Channels, format.channels);
  write32(cpu, list + List.Length, length);
  write32(cpu, list + List.Data, pcm);
  cpu.write(pcm, silenceFor(unit, length));
}

function readOutput(runtime: AudioRuntime, unit: OutputUnit, length: number): Float32Array[] {
  const { cpu } = runtime,
    { work, format, frames } = unit,
    { channels, frameBytes, width } = format;
  const list = work + Work.List;
  const planar = Array.from({ length: channels }, () => new Float32Array(frames));
  if (read32(cpu, work + Work.Flags) & SILENCE_FLAG) return planar;
  if (
    read32(cpu, list + List.Count) !== 1 ||
    read32(cpu, list + List.Channels) !== channels ||
    read32(cpu, list + List.Length) < length ||
    !read32(cpu, list + List.Data)
  )
    throw new Error("RemoteIO callback returned an invalid interleaved AudioBufferList");
  const input = streamView(cpu.read(read32(cpu, list + List.Data), length));
  planar.forEach((out, channel) => {
    for (let index = 0; index < frames; index++) {
      out[index] = format.sample(input, index * frameBytes + channel * width);
      unit.peak = Math.max(unit.peak, Math.abs(out[index] ?? 0));
    }
  });
  return planar;
}

function schedule(
  unit: OutputUnit,
  context: AudioContext,
  resampled: Float32Array<ArrayBuffer>[],
): void {
  const { channels } = unit.format,
    count = resampled[0]?.length ?? 0,
    outputRate = context.sampleRate;
  if (unit.stream?.channels !== channels) {
    unit.stream?.close();
    unit.stream = WorkletStream.open(context, channels) ?? null;
  }
  if (unit.stream) {
    // Buffers still scheduled by the fallback path play first; silence keeps the stream behind them.
    const pending = Math.max(0, unit.frame - Math.ceil(context.currentTime * outputRate));
    if (pending)
      unit.stream.push(Array.from({ length: channels }, () => new Float32Array(pending)));
    unit.frame = 0;
    unit.stream.push(resampled);
    return;
  }
  const buffer = context.createBuffer(channels, count, outputRate);
  resampled.forEach((data, channel) => buffer.copyToChannel(data, channel));
  const earliest = Math.ceil((context.currentTime + RENDER_SLACK) * outputRate);
  if (unit.frame < earliest) {
    if (unit.frame) {
      unit.underruns++;
      unit.lead.underrun();
    }
    unit.frame = earliest;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  unit.sources.add(source);
  source.onended = () => {
    source.disconnect();
    unit.sources.delete(source);
  };
  source.start(unit.frame / outputRate);
  unit.frame += count;
  unit.time = unit.frame / outputRate;
}

async function render(
  runtime: AudioRuntime,
  unit: OutputUnit,
  context: AudioContext,
): Promise<void> {
  const { work, frames, format } = unit,
    { rate, channels, frameBytes } = format;
  const length = frames * frameBytes;
  prepareBuffers(runtime, unit, length);
  const status = Number(
    await runtime.callGuest(unit.callback, [
      unit.ref,
      work,
      work + Work.Timestamp,
      0,
      frames,
      work + Work.List,
    ]),
  );
  if (status) throw new Error("RemoteIO render callback returned OSStatus " + (status | 0));
  const planar = readOutput(runtime, unit, length);
  unit.samples += frames;
  // One continuous resampler and a sample-exact schedule keep buffer joins click-free.
  const outputRate = context.sampleRate;
  if (
    !unit.resampler ||
    unit.resampler.engine.outputRate !== outputRate ||
    unit.resampler.channels !== channels ||
    unit.resampler.rate !== rate
  )
    unit.resampler = { engine: new StreamResampler(rate, outputRate, channels), channels, rate };
  const resampled = ownedChannels(unit.resampler.engine.process(planar));
  if (resampled[0]?.length) schedule(unit, context, resampled);
}

export async function pumpUnits(runtime: AudioRuntime): Promise<void> {
  const { context } = runtime;
  if (runtime.rendering || !context || context.state !== "running" || !runtime.session.active)
    return;
  runtime.rendering = true;
  try {
    for (const unit of runtime.units.values()) {
      // Cap callback count if guest rendering takes longer than real time.
      const now = context.currentTime;
      unit.lead.settle(unit.settled ? now - unit.settled : 0);
      unit.settled = now;
      const dry = unit.stream?.takeUnderruns() ?? 0;
      if (dry && unit.started) {
        unit.underruns++;
        unit.lead.underrun();
      }
      const behind = () =>
        unit.stream
          ? unit.stream.queuedSeconds < unit.lead.target
          : unit.time < now + unit.lead.target;
      for (let burst = 0; burst < MAX_BURSTS && unit.started && behind(); burst++)
        await render(runtime, unit, context);
    }
  } finally {
    runtime.rendering = false;
  }
}
