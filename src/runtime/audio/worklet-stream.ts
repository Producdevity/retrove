const PROCESSOR = "retrove-stream";
/** Render quanta between position reports (about 23 ms at 44.1 kHz). */
const REPORT_QUANTA = 8;
/** A report is [frames played, quanta that ran dry]. */
const REPORT_FIELDS = 2;
/**
 * Plays posted planar buffers back to back and reports frames played and quanta that ran dry
 * after playback began. Plain JS: the worklet scope loads it from a blob, outside the bundle.
 */
const SOURCE = `class RetroveStream extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; this.offset = 0; this.played = 0; this.dry = 0; this.quanta = 0; this.began = false;
    this.port.onmessage = (event) => { this.queue.push(event.data); };
  }
  process(_inputs, outputs) {
    const out = outputs[0], length = out[0] ? out[0].length : 0;
    let written = 0;
    while (written < length && this.queue.length) {
      const buffer = this.queue[0], frames = buffer[0].length;
      const count = Math.min(length - written, frames - this.offset);
      for (let c = 0; c < out.length; c++)
        out[c].set(buffer[Math.min(c, buffer.length - 1)].subarray(this.offset, this.offset + count), written);
      written += count; this.offset += count;
      if (this.offset >= frames) { this.queue.shift(); this.offset = 0; }
    }
    this.played += written;
    if (written) this.began = true;
    else if (this.began && length) this.dry++;
    if (++this.quanta >= ${REPORT_QUANTA}) {
      this.quanta = 0;
      this.port.postMessage([this.played, this.dry]);
    }
    return true;
  }
}
registerProcessor("${PROCESSOR}", RetroveStream);`;

const modules = new WeakMap<BaseAudioContext, boolean>();

/** Starts loading the stream processor; streams fall back to scheduled buffers until it is ready. */
export function preloadStreamWorklet(context: BaseAudioContext): void {
  if (modules.has(context) || !context.audioWorklet) return;
  modules.set(context, false);
  const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
  void context.audioWorklet
    .addModule(url)
    .then(() => modules.set(context, true))
    .catch(() => modules.delete(context))
    .finally(() => URL.revokeObjectURL(url));
}

const isReport = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === REPORT_FIELDS &&
  typeof value[0] === "number" &&
  typeof value[1] === "number";

/**
 * One continuous output stream on the audio thread. Buffers join sample-exactly with no node per
 * buffer, so main-thread garbage collection and scheduling jitter cannot open gaps between them.
 */
export class WorkletStream {
  #posted = 0;
  #played = 0;
  #dry = 0;
  #reportedDry = 0;
  private constructor(
    private readonly node: AudioWorkletNode,
    readonly rate: number,
    readonly channels: number,
  ) {
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!isReport(event.data)) return;
      [this.#played, this.#dry] = event.data;
    };
  }
  /** A stream on `context`, or undefined while the processor is not loaded. */
  static open(context: AudioContext, channels: number): WorkletStream | undefined {
    if (!modules.get(context)) return undefined;
    const node = new AudioWorkletNode(context, PROCESSOR, {
      numberOfInputs: 0,
      outputChannelCount: [channels],
    });
    node.connect(context.destination);
    return new WorkletStream(node, context.sampleRate, channels);
  }
  /** Seconds of audio posted but not yet played, as of the last report. */
  get queuedSeconds(): number {
    return Math.max(0, this.#posted - this.#played) / this.rate;
  }
  /** Render quanta that ran dry since the last call. */
  takeUnderruns(): number {
    const count = this.#dry - this.#reportedDry;
    this.#reportedDry = this.#dry;
    return count;
  }
  /** Queues planar frames at the context rate; the buffers are transferred. */
  push(planar: readonly Float32Array<ArrayBuffer>[]): void {
    const frames = planar[0]?.length ?? 0;
    if (!frames) return;
    this.#posted += frames;
    this.node.port.postMessage(
      planar,
      planar.map((channel) => channel.buffer),
    );
  }
  close(): void {
    this.node.port.onmessage = null;
    this.node.port.close();
    this.node.disconnect();
  }
}
