import { runFast } from "../../../../cpu/run-fast";

const FLOAT_BYTES = 4;
const SAMPLE_BYTES = 2;
const FILTER_TAPS = 16;
const WINDOW_STEP = 32;
const OUTPUT_SAMPLES = 32;
const HISTORY_ROWS = 17;
const WINDOW_ROWS = 17;
const MINIMUM_SAMPLE = -32768;
const MAXIMUM_SAMPLE = 32767;
const STEREO_CHANNELS = 2;
const EVEN_TAP_STEP = 2;
export const MpegSynthesisLayout = {
  InputBytes: HISTORY_ROWS * FILTER_TAPS * FLOAT_BYTES,
  WindowBytes: WINDOW_ROWS * WINDOW_STEP * FLOAT_BYTES,
  OutputSamples: OUTPUT_SAMPLES,
  SampleBytes: SAMPLE_BYTES,
  MaximumPhase: FILTER_TAPS - 1,
  MaximumChannels: STEREO_CHANNELS,
};
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
class Synthesis {
  constructor(
    private readonly history: DataView,
    private readonly window: DataView,
    private readonly output: DataView,
    private readonly phase: number,
    private readonly channels: number,
  ) {}
  private product(sample: number, coefficient: number): number {
    return runFast(
      runFast(this.history.getFloat32(sample * FLOAT_BYTES, true)) *
        runFast(this.window.getFloat32(coefficient * FLOAT_BYTES, true)),
    );
  }
  private store(index: number, sum: number): void {
    const sample = runFast(sum * MAXIMUM_SAMPLE);
    const value = Number.isNaN(sample)
      ? 0
      : Math.max(MINIMUM_SAMPLE, Math.min(MAXIMUM_SAMPLE, Math.trunc(sample)));
    this.output.setInt16(index * this.channels * SAMPLE_BYTES, value, true);
  }
  forward(): void {
    for (let row = 0; row < FILTER_TAPS; row++) {
      const sample = row * FILTER_TAPS,
        coefficient = FILTER_TAPS - this.phase + row * WINDOW_STEP;
      let sum = this.product(sample, coefficient);
      for (let tap = 1; tap < FILTER_TAPS; tap++) {
        const term = this.product(sample + tap, coefficient + tap);
        sum = runFast(tap % EVEN_TAP_STEP ? sum - term : sum + term);
      }
      this.store(row, sum);
    }
  }
  center(): void {
    const sample = FILTER_TAPS * FILTER_TAPS;
    const coefficient = FILTER_TAPS + FILTER_TAPS * WINDOW_STEP - this.phase;
    let sum = this.product(sample, coefficient);
    for (let tap = EVEN_TAP_STEP; tap < FILTER_TAPS; tap += EVEN_TAP_STEP)
      sum = runFast(sum + this.product(sample + tap, coefficient + tap));
    this.store(FILTER_TAPS, sum);
  }
  reverse(): void {
    for (let row = 0; row < FILTER_TAPS - 1; row++) {
      const sample = (FILTER_TAPS - 1 - row) * FILTER_TAPS;
      const coefficient =
        FILTER_TAPS * WINDOW_STEP - FILTER_TAPS - 1 + this.phase - row * WINDOW_STEP;
      let sum = runFast(-this.product(sample, coefficient));
      for (let tap = 1; tap < FILTER_TAPS; tap++)
        sum = runFast(sum - this.product(sample + tap, coefficient - tap));
      this.store(HISTORY_ROWS + row, sum);
    }
  }
}
export function synthesizeMpeg(
  input: Uint8Array,
  window: Uint8Array,
  phase: number,
  channels: number,
  output: Uint8Array,
): void {
  const outputBytes = ((OUTPUT_SAMPLES - 1) * channels + 1) * SAMPLE_BYTES;
  if (
    !Number.isInteger(phase) ||
    phase < 0 ||
    phase > MpegSynthesisLayout.MaximumPhase ||
    (channels !== 1 && channels !== STEREO_CHANNELS) ||
    input.byteLength < MpegSynthesisLayout.InputBytes ||
    window.byteLength < MpegSynthesisLayout.WindowBytes ||
    output.byteLength < outputBytes
  )
    throw new RangeError("Invalid MPEG synthesis buffers or channel layout.");
  const synthesis = new Synthesis(view(input), view(window), view(output), phase, channels);
  synthesis.forward();
  synthesis.center();
  synthesis.reverse();
}
