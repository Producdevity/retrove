import { Gauge, gauges, type Gauges } from "./gauges";

const MEGABYTE = 1_000_000;
const MILLISECONDS_PER_SECOND = 1000;
/** Rows kept at full resolution before the end of a run, where iOS closes the page. */
const RECENT_ROWS = 24;
/** Older rows, halved in resolution each time they fill up, so a long run still fits a report. */
const HISTORY_ROWS = 14;
/** Each thinning keeps every second history row and halves how often new rows are kept. */
const THIN = 2;

const megabytes = (gauge: Gauges, name: Gauge): number => Math.round(gauge.value(name) / MEGABYTE);

/** One compact line per sample of Retrove's memory accounting, for reports from closed pages. */
export class MemoryTimeline {
  readonly #recent: string[] = [];
  #history: string[] = [];
  #stride = 1;
  #skipped = 0;
  constructor(private readonly gauge: Gauges = gauges) {}
  sample(elapsedMs: number, jsHeapBytes?: number): void {
    const g = this.gauge,
      mb = (name: Gauge) => megabytes(g, name),
      heap = jsHeapBytes === undefined ? "" : ` js ${Math.round(jsHeapBytes / MEGABYTE)}`;
    this.#recent.push(
      `t ${Math.round(elapsedMs / MILLISECONDS_PER_SECOND)}s guest ${mb(Gauge.GuestMappedBytes)}` +
        ` wasmMem ${mb(Gauge.WasmMemoryBytes)} code ${mb(Gauge.TranslatedCodeBytes)}` +
        ` tex ${mb(Gauge.GpuTextureBytes)} buf ${mb(Gauge.GpuBufferBytes)} rb ${mb(Gauge.GpuRenderbufferBytes)}` +
        ` files ${mb(Gauge.FileCacheBytes)} | modules ${g.value(Gauge.WasmInstancesCompiled)}` +
        ` compiled ${mb(Gauge.WasmBytesCompiled)} flushes ${g.value(Gauge.CodeFlushes)}` +
        ` | reads ${g.value(Gauge.BundleReads)} ${mb(Gauge.BundleReadBytes)}${heap}`,
    );
    const oldest = this.#recent.length > RECENT_ROWS ? this.#recent.shift() : undefined;
    if (oldest === undefined || ++this.#skipped < this.#stride) return;
    this.#skipped = 0;
    this.#history.push(oldest);
    if (this.#history.length <= HISTORY_ROWS) return;
    this.#history = this.#history.filter((_, index) => index % THIN === 0);
    this.#stride *= THIN;
  }
  rows(): readonly string[] {
    return [...this.#history, ...this.#recent];
  }
}
