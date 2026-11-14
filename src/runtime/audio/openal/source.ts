import {
  AL,
  ALError,
  DEFAULT_MAX_DISTANCE,
  FULL_CIRCLE_DEGREES,
  OpenALError,
  type Vector3,
} from "./constants";
import type { PCM } from "./pcm";
import type { AudioOutput, Voice, VoiceProperties } from "./output";
export interface QueuedBuffer {
  readonly name: number;
  readonly pcm: PCM;
}
export class Source {
  readonly queue: QueuedBuffer[] = [];
  readonly voices: Voice[] = [];
  state: number = AL.Initial;
  kind: number = AL.Undetermined;
  looping = false;
  relative = false;
  gain = 1;
  pitch = 1;
  minGain = 0;
  maxGain = 1;
  position: Vector3 = [0, 0, 0];
  direction: Vector3 = [0, 0, 0];
  velocity: Vector3 = [0, 0, 0];
  referenceDistance = 1;
  maxDistance = DEFAULT_MAX_DISTANCE;
  rolloff = 1;
  coneInner = FULL_CIRCLE_DEGREES;
  coneOuter = FULL_CIRCLE_DEGREES;
  coneGain = 0;
  private suspended = false;
  private looped: PCM | undefined;
  private offset = 0;
  private anchor = 0;
  constructor(readonly output: AudioOutput) {}
  get duration(): number {
    return this.queue.reduce((sum, item) => sum + item.pcm.duration, 0);
  }
  get cursor(): number {
    const offset =
        this.offset +
        (this.state === AL.Playing && !this.suspended
          ? (this.output.time - this.anchor) * this.pitch
          : 0),
      duration = this.duration;
    if (this.looping && duration) return offset % duration;
    if (this.state === AL.Playing && offset >= duration) {
      this.state = AL.Stopped;
      this.offset = duration;
      this.stopVoices();
    }
    return Math.min(offset, duration);
  }
  get processed(): number {
    if (this.looping || this.state === AL.Initial) return 0;
    const cursor = this.cursor;
    let end = 0,
      count = 0;
    for (const item of this.queue) {
      end += item.pcm.duration;
      if (end > cursor) break;
      count++;
    }
    return count;
  }
  properties(): VoiceProperties {
    return {
      gain: Math.min(this.maxGain, Math.max(this.minGain, this.gain)),
      pitch: this.pitch,
      position: this.position,
      direction: this.direction,
      referenceDistance: this.referenceDistance,
      maxDistance: this.maxDistance,
      rolloff: this.rolloff,
      coneInner: this.coneInner,
      coneOuter: this.coneOuter,
      coneGain: this.coneGain,
    };
  }
  stopVoices(): void {
    for (const voice of this.voices) voice.stop();
    this.voices.length = 0;
  }
  play(): void {
    this.offset = this.state === AL.Paused ? this.offset : 0;
    this.anchor = this.output.time;
    this.state = this.duration ? AL.Playing : AL.Stopped;
    this.schedule();
  }
  pause(): void {
    if (this.state !== AL.Playing) return;
    const cursor = this.cursor;
    if (this.state !== AL.Playing) return;
    this.offset = cursor;
    this.state = AL.Paused;
    this.stopVoices();
  }
  stop(): void {
    if (this.state === AL.Initial) return;
    this.offset = this.duration;
    this.state = AL.Stopped;
    this.stopVoices();
  }
  rewind(): void {
    this.offset = 0;
    this.state = AL.Initial;
    this.stopVoices();
  }
  reschedule(): void {
    this.offset = this.cursor;
    this.anchor = this.output.time;
    this.schedule();
  }
  changePitch(value: number): void {
    const cursor = this.cursor;
    this.pitch = value;
    this.offset = cursor;
    this.anchor = this.output.time;
    this.schedule();
  }
  seek(seconds: number): void {
    if (seconds < 0 || seconds > this.duration) throw new OpenALError(ALError.InvalidValue);
    this.offset = seconds;
    this.anchor = this.output.time;
    this.schedule();
  }
  suspend(): void {
    this.offset = this.cursor;
    this.suspended = true;
    this.stopVoices();
  }
  resume(): void {
    this.suspended = false;
    this.anchor = this.output.time;
    this.schedule();
  }
  bind(buffer: QueuedBuffer | undefined): void {
    void this.cursor;
    if (this.state === AL.Playing || this.state === AL.Paused)
      throw new OpenALError(ALError.InvalidOperation);
    this.rewind();
    this.looped = undefined;
    this.queue.length = 0;
    this.kind = buffer ? AL.Static : AL.Undetermined;
    if (buffer) this.queue.push(buffer);
  }
  private loopPCM(): PCM {
    if (this.looped) return this.looped;
    const first = this.queue.find((item) => item.pcm.frames)?.pcm;
    if (!first) throw new OpenALError(ALError.InvalidOperation);
    if (this.queue.length === 1) return first;
    const frames = this.queue.reduce((sum, item) => sum + item.pcm.frames, 0);
    const channels = first.channels.map((_channel, index) => {
      const samples = new Float32Array(frames);
      let offset = 0;
      for (const item of this.queue) {
        const channel = item.pcm.channels[index];
        if (channel) samples.set(channel, offset);
        offset += item.pcm.frames;
      }
      return samples;
    });
    return (this.looped = { ...first, channels, frames, duration: frames / first.rate });
  }
  private schedule(): void {
    this.stopVoices();
    if (this.state !== AL.Playing || this.suspended) return;
    if (this.looping) {
      const pcm = this.loopPCM();
      this.voices.push(
        this.output.play(
          pcm,
          this.output.time,
          this.offset % pcm.duration,
          pcm.duration,
          this.properties(),
          true,
        ),
      );
      return;
    }
    let offset = this.offset,
      at = this.output.time;
    for (const item of this.queue) {
      if (offset >= item.pcm.duration) {
        offset -= item.pcm.duration;
        continue;
      }
      const duration = item.pcm.duration - offset;
      this.voices.push(this.output.play(item.pcm, at, offset, duration, this.properties()));
      at += duration / this.pitch;
      offset = 0;
    }
  }
  append(buffers: readonly QueuedBuffer[]): void {
    if (this.kind === AL.Static) throw new OpenALError(ALError.InvalidOperation);
    const format = this.queue[0]?.pcm ?? buffers[0]?.pcm;
    if (
      format &&
      buffers.some(
        ({ pcm }) =>
          pcm.rate !== format.rate ||
          pcm.channels.length !== format.channels.length ||
          pcm.sampleBytes !== format.sampleBytes,
      )
    )
      throw new OpenALError(ALError.InvalidOperation);
    const cursor = this.cursor;
    this.kind = AL.Streaming;
    this.looped = undefined;
    this.queue.push(...buffers);
    this.offset = cursor;
    this.anchor = this.output.time;
    this.schedule();
  }
  unqueue(count: number): QueuedBuffer[] {
    if (count > this.processed || this.kind !== AL.Streaming)
      throw new OpenALError(ALError.InvalidValue);
    const cursor = this.cursor,
      removed = this.queue.splice(0, count);
    this.looped = undefined;
    this.offset = Math.max(0, cursor - removed.reduce((sum, item) => sum + item.pcm.duration, 0));
    this.anchor = this.output.time;
    this.schedule();
    return removed;
  }
}
