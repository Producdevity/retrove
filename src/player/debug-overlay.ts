import { Gauge, gauges as shared, type Gauges } from "../runtime/diagnostics/gauges";

const STORAGE_KEY = "retrove.debug-overlay";
const ENABLED = "on";
const REFRESH_MS = 500;
const MILLISECONDS = 1000;
const PERCENT = 100;
const MEBIBYTE = 1_048_576;
const LABEL_WIDTH = 9;
const VALUE_WIDTH = 8;
const MESSAGE_CHARACTERS = 72;

export interface OverlayMessage {
  readonly level: string;
  readonly area: string;
  readonly message: string;
}
interface Sample {
  readonly at: number;
  readonly frames: number;
  readonly cpuMs: number;
}

function megabytes(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
}
function row(label: string, value: string, note = ""): string {
  return `${label.padEnd(LABEL_WIDTH)}${value.padStart(VALUE_WIDTH)}${note ? `  ${note}` : ""}`;
}
/** Chrome's non-standard heap size; Safari has no equivalent. */
function jsHeapBytes(): number | undefined {
  const memory: unknown = Reflect.get(performance, "memory");
  if (typeof memory !== "object" || memory === null) return undefined;
  const used: unknown = Reflect.get(memory, "usedJSHeapSize");
  return typeof used === "number" ? used : undefined;
}
function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === ENABLED;
  } catch {
    return false;
  }
}
function saveEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, ENABLED);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The overlay still toggles for this session.
  }
}

/**
 * Live performance and memory figures over the game. It never takes input or focus, and it
 * only does work while shown: two text updates a second, no layout outside its own box.
 */
export class DebugOverlay {
  #timer: ReturnType<typeof setInterval> | undefined;
  #last: Sample | undefined;
  #peak = 0;
  #warnings = 0;
  #errors = 0;
  #latest = "";
  constructor(
    private readonly panel: HTMLElement,
    private readonly toggle: HTMLButtonElement,
    private readonly gauges: Gauges = shared,
  ) {
    toggle.addEventListener("click", () => {
      this.show(!this.shown);
      toggle.blur();
    });
    this.show(readEnabled());
  }
  get shown(): boolean {
    return this.#timer !== undefined;
  }
  /** Counts warnings and errors so the overlay can show them as they happen. */
  record(entry: OverlayMessage): void {
    if (entry.level === "warn") this.#warnings++;
    else if (entry.level === "error") this.#errors++;
    else return;
    this.#latest = `[${entry.area}] ${entry.message}`.slice(0, MESSAGE_CHARACTERS);
  }
  show(visible: boolean): void {
    saveEnabled(visible);
    this.panel.hidden = !visible;
    this.toggle.setAttribute("aria-pressed", String(visible));
    if (!visible) {
      clearInterval(this.#timer);
      this.#timer = undefined;
      return;
    }
    if (this.#timer !== undefined) return;
    this.#last = undefined;
    this.render();
    this.#timer = setInterval(() => this.render(), REFRESH_MS);
  }
  private rates(): { fps: number; cpu: number } {
    const now: Sample = {
      at: performance.now(),
      frames: this.gauges.value(Gauge.PresentedFrames),
      cpuMs: this.gauges.value(Gauge.GuestCpuMs),
    };
    const last = this.#last;
    this.#last = now;
    const elapsed = last ? now.at - last.at : 0;
    if (!last || elapsed <= 0) return { fps: 0, cpu: 0 };
    return {
      fps: ((now.frames - last.frames) * MILLISECONDS) / elapsed,
      cpu: ((now.cpuMs - last.cpuMs) * PERCENT) / elapsed,
    };
  }
  private render(): void {
    const value = (gauge: Gauge): number => this.gauges.value(gauge);
    const { fps, cpu } = this.rates();
    const wasm = value(Gauge.WasmMemoryBytes),
      code = value(Gauge.TranslatedCodeBytes),
      textures = value(Gauge.GpuTextureBytes),
      buffers = value(Gauge.GpuBufferBytes),
      renderbuffers = value(Gauge.GpuRenderbufferBytes),
      files = value(Gauge.FileCacheBytes),
      heap = jsHeapBytes();
    const total = wasm + code + textures + buffers + renderbuffers + files + (heap ?? 0);
    this.#peak = Math.max(this.#peak, total);
    this.panel.textContent = [
      `FPS ${fps.toFixed(1)}  guest CPU ${cpu.toFixed(0)}%  threads ${value(Gauge.GuestThreads)}`,
      row("Tracked", megabytes(total), `peak ${megabytes(this.#peak)}`),
      row(
        "Wasm",
        megabytes(wasm),
        `guest ${megabytes(value(Gauge.GuestMappedBytes))}, peak ${megabytes(value(Gauge.GuestMappedPeak))}`,
      ),
      row(
        "Code",
        megabytes(code),
        `${value(Gauge.TranslatedFunctions)} fn, ${value(Gauge.CodeFlushes)} flushes`,
      ),
      row("Textures", megabytes(textures)),
      row("Buffers", megabytes(buffers), `render ${megabytes(renderbuffers)}`),
      row("Files", megabytes(files)),
      row("JS heap", heap === undefined ? "n/a" : megabytes(heap)),
      `Warnings ${this.#warnings}  errors ${this.#errors}`,
      this.#latest,
    ].join("\n");
  }
}
