import "../ui/appearance.css";
import { initializeAppearance } from "../ui/appearance";
import { element } from "../ui/dom";
import { syntheticModule } from "./wasm-module";

const STORAGE_KEY = "retrove.device-probe.v2";
const WASM_PAGE = 65_536;
const MEBIBYTE = 1_048_576;
const STEP_MB = 64;
const STEP_PAGES = (STEP_MB * MEBIBYTE) / WASM_PAGE;
const MAX_PAGES = 65_535;
/** Roughly 2, 8 and 32 MB modules, the size range of translated game code. */
const FUNCTIONS_PER_2_MB = 10_000;
const SIZE_GROWTH = 4;
const COMPILE_SIZES = 3;
const COMPILE_FUNCTIONS = Array.from(
  { length: COMPILE_SIZES },
  (_, index) => FUNCTIONS_PER_2_MB * SIZE_GROWTH ** index,
);
const PAUSE_MS = 30;
const INDENT = 2;
const Phase = { Reserve: "reserve", Compile: "compile", Touch: "touch", Done: "done" } as const;
type Phase = (typeof Phase)[keyof typeof Phase];

interface CompileResult {
  readonly megabytes: number;
  readonly milliseconds: number;
}
interface ProbeState {
  phase: Phase;
  /** Megabytes reached, or attempted when the page died mid-step. */
  reserveMB: number;
  touchMB: number;
  attemptMB: number;
  /** Set when the previous load ended during a step. */
  killedIn: Phase[];
  compile: CompileResult[];
}
const fresh = (): ProbeState => ({
  phase: Phase.Reserve,
  reserveMB: 0,
  touchMB: 0,
  attemptMB: 0,
  killedIn: [],
  compile: [],
});
function load(): ProbeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof parsed !== "object" || parsed === null) return fresh();
    const state = fresh();
    for (const key of Object.keys(state)) {
      const value: unknown = Reflect.get(parsed, key);
      if (value !== undefined) Reflect.set(state, key, value);
    }
    return state;
  } catch {
    return fresh();
  }
}
function save(state: ProbeState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

const status = element("probe-status", HTMLParagraphElement),
  output = element("probe-output", HTMLPreElement);
function environment(): Record<string, unknown> {
  return {
    userAgent: navigator.userAgent,
    deviceMemory: Reflect.get(navigator, "deviceMemory"),
    cores: navigator.hardwareConcurrency,
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    standalone: matchMedia("(display-mode: standalone)").matches,
  };
}
function show(state: ProbeState): void {
  output.textContent = JSON.stringify({ ...state, environment: environment() }, null, INDENT);
}

/** iOS compresses idle pages, so only incompressible bytes show the real limit. */
const RANDOM_CHUNK = 65_536;
const RANDOM_BLOCK = MEBIBYTE;
const randomBlock = (() => {
  const block = new Uint8Array(RANDOM_BLOCK);
  for (let at = 0; at < block.length; at += RANDOM_CHUNK)
    crypto.getRandomValues(block.subarray(at, at + RANDOM_CHUNK));
  return block;
})();
function fillIncompressible(memory: WebAssembly.Memory, start: number, length: number): void {
  const view = new Uint8Array(memory.buffer, start, length);
  for (let at = 0; at < length; at += RANDOM_BLOCK)
    view.set(randomBlock.subarray(0, Math.min(RANDOM_BLOCK, length - at)), at);
}
/** Grows one memory in steps, touching every new page when `touch`, until growth fails. */
async function grow(state: ProbeState, touch: boolean): Promise<void> {
  const memory = new WebAssembly.Memory({ initial: 1 });
  for (let pages = 1; pages + STEP_PAGES <= MAX_PAGES; pages += STEP_PAGES) {
    state.attemptMB = ((pages + STEP_PAGES) * WASM_PAGE) / MEBIBYTE;
    save(state);
    status.textContent = `${touch ? "Filling" : "Reserving"} ${state.attemptMB} MB…`;
    try {
      memory.grow(STEP_PAGES);
    } catch {
      break;
    }
    if (touch) fillIncompressible(memory, pages * WASM_PAGE, STEP_PAGES * WASM_PAGE);
    if (touch) state.touchMB = state.attemptMB;
    else state.reserveMB = state.attemptMB;
    save(state);
    show(state);
    await pause();
  }
  state.attemptMB = 0;
}
async function compile(state: ProbeState): Promise<void> {
  for (const count of COMPILE_FUNCTIONS) {
    const bytes = syntheticModule(count);
    status.textContent = `Compiling ${(bytes.length / MEBIBYTE).toFixed(1)} MB of Wasm…`;
    await pause();
    const started = performance.now();
    await WebAssembly.compile(bytes);
    state.compile.push({
      megabytes: Number((bytes.length / MEBIBYTE).toFixed(1)),
      milliseconds: Math.round(performance.now() - started),
    });
    save(state);
    show(state);
  }
}
async function run(): Promise<void> {
  const state = load();
  if (state.attemptMB) {
    state.killedIn.push(state.phase);
    state.attemptMB = 0;
    state.phase = state.phase === Phase.Reserve ? Phase.Compile : Phase.Done;
    save(state);
  }
  show(state);
  if (state.phase === Phase.Reserve) {
    await grow(state, false);
    state.phase = Phase.Compile;
    save(state);
  }
  if (state.phase === Phase.Compile) {
    await compile(state);
    state.phase = Phase.Touch;
    save(state);
  }
  if (state.phase === Phase.Touch) {
    await grow(state, true);
    state.phase = Phase.Done;
    save(state);
  }
  status.textContent = "Done. Copy the results and send them.";
  show(state);
}

initializeAppearance();
element("probe-copy", HTMLButtonElement).addEventListener("click", () => {
  void navigator.clipboard.writeText(output.textContent ?? "");
});
element("probe-reset", HTMLButtonElement).addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});
element("probe-start", HTMLButtonElement).addEventListener("click", (event) => {
  if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.disabled = true;
  run().catch((error: unknown) => {
    status.textContent = `Probe failed: ${String(error)}`;
  });
});
show(load());
