/** Lead time bounds in seconds: short for responsive effects, longer after the main thread stalls. */
export const Lead = { Minimum: 0.06, Maximum: 0.35, Growth: 1.5, DecayPerSecond: 0.01 } as const;

/**
 * Adaptive output lead: each underrun grows how far ahead audio is queued, and quiet time
 * shrinks it back, so loading stalls stop crackling without adding latency during play.
 */
export class OutputLead {
  #target: number = Lead.Minimum;
  get target(): number {
    return this.#target;
  }
  underrun(): void {
    this.#target = Math.min(Lead.Maximum, this.#target * Lead.Growth);
  }
  settle(seconds: number): void {
    if (seconds > 0)
      this.#target = Math.max(Lead.Minimum, this.#target - seconds * Lead.DecayPerSecond);
  }
}

/**
 * Linear resampler that carries its phase and last input frame across buffers, so consecutive
 * guest buffers join without the edge discontinuities of resampling each one separately.
 */
export class StreamResampler {
  readonly #step: number;
  #phase = 0;
  #previous: number[];
  constructor(
    inputRate: number,
    readonly outputRate: number,
    channels: number,
  ) {
    if (!(inputRate > 0 && outputRate > 0 && channels > 0)) throw new Error("Invalid resampler.");
    this.#step = inputRate / outputRate;
    this.#previous = Array.from({ length: channels }, () => 0);
  }
  /** Resamples planar input; returns planar output at the output rate. */
  process(input: readonly Float32Array[]): Float32Array[] {
    const frames = input[0]?.length ?? 0;
    // Position runs from -1 (the previous buffer's last frame) to frames - 1.
    const count = Math.max(0, Math.floor((frames - 1 - this.#phase) / this.#step) + 1);
    const output = input.map(() => new Float32Array(count));
    for (let index = 0; index < count; index++) {
      const position = this.#phase + index * this.#step,
        base = Math.floor(position),
        fraction = position - base;
      input.forEach((channel, c) => {
        const before = base < 0 ? (this.#previous[c] ?? 0) : (channel[base] ?? 0);
        const after = channel[base + 1] ?? before;
        const target = output[c];
        if (target) target[index] = before + (after - before) * fraction;
      });
    }
    this.#phase += count * this.#step - frames;
    input.forEach((channel, c) => {
      this.#previous[c] = channel[frames - 1] ?? this.#previous[c] ?? 0;
    });
    return output;
  }
}
