import type { PlayerOutput, PlayerVoice } from "./output";
const PlaybackRate = { Minimum: 0.5, Maximum: 2 } as const;
export class PlayerTransport {
  private voice: PlayerVoice | undefined;
  private offset = 0;
  private startedAt = 0;
  private loopsRemaining = 0;
  private finished = false;
  private gain = 1;
  private balance = 0;
  private speed = 1;
  private rateEnabled = false;
  private loops = 0;
  constructor(
    readonly buffer: AudioBuffer,
    private readonly output: PlayerOutput,
  ) {}
  get playing(): boolean {
    return this.voice !== undefined;
  }
  get currentTime(): number {
    return this.playing ? (this.offset + this.elapsed()) % this.buffer.duration : this.offset;
  }
  get deviceTime(): number {
    return this.output.time;
  }
  get volume(): number {
    return this.gain;
  }
  set volume(value: number) {
    if (Number.isFinite(value)) {
      this.gain = Math.max(0, Math.min(1, value));
      this.voice?.volume(this.gain);
    }
  }
  get pan(): number {
    return this.balance;
  }
  set pan(value: number) {
    if (Number.isFinite(value)) {
      this.balance = Math.max(-1, Math.min(1, value));
      this.voice?.pan(this.balance);
    }
  }
  get rate(): number {
    return this.speed;
  }
  set rate(value: number) {
    if (Number.isFinite(value))
      this.change(() => {
        this.speed = Math.max(PlaybackRate.Minimum, Math.min(PlaybackRate.Maximum, value));
      });
  }
  get enableRate(): boolean {
    return this.rateEnabled;
  }
  set enableRate(value: boolean) {
    this.change(() => {
      this.rateEnabled = value;
    });
  }
  get numberOfLoops(): number {
    return this.loops;
  }
  set numberOfLoops(value: number) {
    this.change(() => {
      this.loops = value | 0;
      this.loopsRemaining = this.loops;
    });
  }
  get completionPending(): boolean {
    return this.finished;
  }
  prepare(): boolean {
    return this.output.ready;
  }
  play(when = this.output.time): boolean {
    if (this.playing) return true;
    if (!this.output.ready || !Number.isFinite(when)) return false;
    this.finished = false;
    this.startedAt = Math.max(when, this.output.time);
    if (this.offset >= this.buffer.duration) this.offset = 0;
    const seconds =
      this.loopsRemaining < 0
        ? Infinity
        : this.buffer.duration - this.offset + this.loopsRemaining * this.buffer.duration;
    this.voice = this.output.play(
      this.buffer,
      this.startedAt,
      this.offset,
      seconds,
      this.effectiveRate(),
      this.gain,
      this.balance,
      () => {
        this.voice = undefined;
        this.offset = 0;
        this.loopsRemaining = this.loops;
        this.finished = true;
      },
    );
    return true;
  }
  pause(): void {
    if (!this.voice) return;
    const position = this.offset + this.elapsed(),
      completed = Math.floor(position / this.buffer.duration);
    this.offset = position % this.buffer.duration;
    if (this.loopsRemaining >= 0)
      this.loopsRemaining = Math.max(0, this.loopsRemaining - completed);
    const voice = this.voice;
    this.voice = undefined;
    voice.stop();
  }
  stop(): void {
    this.pause();
    this.finished = false;
    this.loopsRemaining = this.loops;
  }
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const playing = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.buffer.duration, seconds));
    this.finished = false;
    if (playing) this.play();
  }
  takeCompletion(): boolean {
    const value = this.finished;
    this.finished = false;
    return value;
  }
  private effectiveRate(): number {
    return this.rateEnabled ? this.speed : 1;
  }
  private elapsed(): number {
    return Math.max(0, this.output.time - this.startedAt) * this.effectiveRate();
  }
  private change(update: () => void): void {
    const playing = this.playing;
    this.pause();
    update();
    if (playing) this.play();
  }
}
