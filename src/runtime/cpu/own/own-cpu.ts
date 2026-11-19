import { ExecutionBudget } from "../execution-budget";
import { Gauge, gauges } from "../../diagnostics/gauges";
import { runTranslated } from "../translation/runner";
import { TranslatedTier } from "../translation/tier";
import type { TranslationProfile } from "../translation/translation-profile";
import { ArenaHeap } from "./arena-heap";
import { GuestState, type SavedState } from "./guest-state";
import { GuestMappings, guestRange } from "./guest-mappings";

const REGISTERS = 16;
const HEX = 16;
const MAX_BUDGET = 0x7fff_ffff;
const DEFAULT_BUDGET = 100_000;
/** Entries tried for one PC before the instruction there is treated as untranslatable. */
const RETRIES = 2;

export type RunResult =
  | { readonly reason: "until" | "budget"; readonly pc: number }
  | { readonly reason: "trap"; readonly address: number; readonly pc: number };
/** Receives the CPU object the runtime holds (the facade), and the trapped address. */
export type TrapHandler = (cpu: unknown, address: number) => void;
interface Trap {
  readonly first: number;
  readonly last: number;
  readonly fn: TrapHandler;
}
export interface OwnCpuOptions {
  readonly budget?: ExecutionBudget;
  readonly profile?: TranslationProfile | undefined;
  readonly onProfile?: ((profile: TranslationProfile) => void) | undefined;
  readonly cache?: string | undefined;
  readonly codeBudget?: number | undefined;
}
/** Thrown for guest code that neither translates nor has an interpreted fallback. */
export class GuestCodeError extends Error {
  constructor(readonly pc: number) {
    super(`Guest CPU cannot run the instruction at 0x${pc.toString(HEX)}.`);
  }
}

/**
 * A guest CPU with no interpreter underneath: every instruction runs as translated Wasm, code is
 * translated on the calling thread the first time it runs, and host traps are dispatched when
 * translated code leaves for a trap address.
 */
export class OwnCpu {
  readonly tier: TranslatedTier;
  /** The object handed to the runtime; trap handlers receive it. */
  facade: object | undefined;
  readonly #state: GuestState;
  readonly #memory: GuestMappings;
  readonly #traps: Trap[] = [];
  #executed = 0;
  #closed = false;
  constructor(
    readonly budget: ExecutionBudget = ExecutionBudget.Blocks,
    options: OwnCpuOptions = {},
  ) {
    this.tier = new TranslatedTier(new ArenaHeap(), options);
    this.tier.excluded = (pc) => this.#trapAt(pc) !== undefined;
    this.#state = new GuestState(
      () => this.tier.layout,
      () => this.tier.pages.view,
    );
    this.#memory = new GuestMappings(this.tier);
    gauges.read(Gauge.WasmMemoryBytes, () => this.#memory.committedBytes);
    gauges.read(Gauge.GuestMappedBytes, () => this.#memory.mappedBytes);
    gauges.read(Gauge.GuestMappedPeak, () => this.#memory.mappedPeak);
    gauges.read(Gauge.GuestCpuMs, () => this.#executed);
    gauges.read(Gauge.TranslatedFunctions, () => this.tier.statistics.translatedFunctions);
    gauges.read(Gauge.CodeFlushes, () => this.tier.statistics.flushes);
    gauges.read(Gauge.AotPrepared, () => this.tier.statistics.aotPrepared);
    gauges.read(Gauge.AotChunks, () => this.tier.statistics.aotChunks);
  }
  get compiler(): undefined {
    return undefined;
  }
  get translation() {
    return this.tier.statistics;
  }
  get mappedBytes(): number {
    return this.#memory.mappedBytes;
  }
  get executedMilliseconds(): number {
    return this.#executed;
  }
  get interpretedMilliseconds(): number {
    return 0;
  }
  set threadPointer(address: number) {
    this.#state.threadPointer = address;
  }
  map(address: number, size: number, permissions?: number): void {
    this.#memory.map(address, size, permissions);
  }
  unmap(address: number, size: number): void {
    this.#memory.unmap(address, size);
  }
  protect(address: number, size: number, permissions: number): void {
    this.#memory.protect(address, size, permissions);
  }
  write(address: number, bytes: Uint8Array | ArrayLike<number>): void {
    this.#memory.write(address, bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  }
  read(address: number, length: number): Uint8Array {
    return this.#memory.read(address, length);
  }
  read32(address: number): number {
    return this.#memory.read32(address);
  }
  getReg(register: number): number {
    return this.#state.get(this.#register(register));
  }
  setReg(register: number, value: number): void {
    this.#state.set(this.#register(register), value);
  }
  #register(register: number): number {
    if (!Number.isInteger(register) || register < 0 || register >= REGISTERS)
      throw new RangeError("Expected register r0–r15");
    return register;
  }
  get cpsr(): number {
    return this.#state.cpsr;
  }
  set cpsr(value: number) {
    this.#state.cpsr = value;
  }
  get nextPC(): number {
    return this.#state.pc;
  }
  branch(target: number): void {
    this.#state.pc = guestRange(target, 0) >>> 0;
  }
  trap(address: number, fn: TrapHandler): () => void {
    const pc = (guestRange(address, 0) & ~1) >>> 0;
    return this.trapRange(pc, pc, fn);
  }
  trapRange(first: number, last: number, fn: TrapHandler): () => void {
    guestRange(first, 0);
    guestRange(last, 0);
    if (first > last) throw new TypeError("Invalid trap range or callback");
    const record = { first, last, fn };
    this.#traps.push(record);
    return () => {
      const at = this.#traps.indexOf(record);
      if (at >= 0) this.#traps.splice(at, 1);
    };
  }
  #trapAt(pc: number): Trap | undefined {
    const address = pc & ~1;
    return this.#traps.find((trap) => address >= trap.first && address <= trap.last);
  }
  run(startPC = this.nextPC, { until = 0, count = DEFAULT_BUDGET } = {}): RunResult {
    guestRange(startPC, 0);
    guestRange(until, 0);
    if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_BUDGET)
      throw new RangeError("A positive instruction budget is required");
    const before = performance.now();
    try {
      return this.#run(startPC >>> 0, until >>> 0, count);
    } finally {
      this.#executed += performance.now() - before;
    }
  }
  #run(start: number, until: number, count: number): RunResult {
    const state = this.#state,
      tier = this.tier;
    let pc = start,
      budget = count,
      tries = 0;
    for (;;) {
      state.pc = pc;
      const trap = this.#trapAt(pc);
      if (trap) {
        const address = (pc & ~1) >>> 0;
        trap.fn(this.facade ?? this, address);
        return { reason: "trap", address, pc: state.pc };
      }
      if (until && (pc & ~1) === (until & ~1)) return { reason: "until", pc };
      if (!tier.entry(pc) || tries > 0) {
        if (tries >= RETRIES || !tier.translateNow(pc)) throw new GuestCodeError(pc);
      }
      const result = runTranslated(tier, state, pc, until, budget);
      if (result.reason !== "fallback") return result;
      budget = Math.max(1, tier.pages.view.getInt32(tier.layout.budget, true));
      tries = result.pc === pc ? tries + 1 : 0;
      pc = result.pc;
    }
  }
  saveState(): { translated: SavedState; threadPointer: number } {
    return { translated: this.#state.save(), threadPointer: this.#state.threadPointer };
  }
  restoreState(saved: { readonly translated: SavedState; readonly threadPointer: number }): void {
    this.#state.restore(saved.translated);
    this.#state.threadPointer = saved.threadPointer;
  }
  freeState(): void {}
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.tier.close();
  }
}
