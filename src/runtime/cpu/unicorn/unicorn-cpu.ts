import type { ExecutionBudget } from "../execution-budget";
import type { RunResult, TrapHandler } from "../own/own-cpu";
import type { TciTierStatistics } from "../tci/tier";
import type { RegisterBridge } from "../translation/register-bridge";
import { runTranslated } from "../translation/runner";
import type { TierStatistics } from "../translation/tier-statistics";
import { Gauge, gauges } from "../../diagnostics/gauges";
import type { UnicornContexts } from "./contexts";
import { UnicornMemory } from "./memory";
import type { UnicornParts } from "./setup";
import { memoryFaultHook, startUserMode, type MemoryFault } from "./startup";

const PC = 15;
const THUMB_SHIFT = 5;
const HEX = 16;
const UINT32_MAX = 0xffff_ffff;
const MAX_BUDGET = 0x7fff_ffff;
const DEFAULT_BUDGET = 100_000;
/** Translated code must not run into the instruction after a trap range either. */
const TRAP_GUARD = 4;

interface Trap {
  readonly first: number;
  readonly last: number;
  readonly fn: TrapHandler;
}
interface Pending {
  readonly address: number;
  readonly fn: TrapHandler;
}
export interface RunLimits {
  readonly until?: number;
  readonly count?: number;
}
export type UnicornState =
  | { readonly unicorn: ReturnType<UnicornContexts<number>["save"]> }
  | { readonly translated: ReturnType<RegisterBridge["save"]>; readonly threadPointer: number };

function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX)
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  return value;
}

/** The Unicorn interpreter, with the translated tier in front of it when translation is enabled. */
export class UnicornCpu {
  /** The object handed to the runtime; trap handlers receive it. */
  facade: unknown;
  readonly memory: UnicornMemory;
  readonly #parts: UnicornParts;
  readonly #traps: Trap[] = [];
  readonly #hooks = new Set<unknown>();
  #pending: Pending | null = null;
  #memoryFault: MemoryFault | null = null;
  #closed = false;
  #failedWasm = false;
  #executed = 0;
  #interpreted = 0;
  constructor(
    readonly budget: ExecutionBudget,
    parts: UnicornParts,
  ) {
    this.#parts = parts;
    this.memory = new UnicornMemory(parts);
    const { uc, engine, translation } = parts;
    if (translation) translation.tier.excluded = (pc) => this.#excluded(pc);
    const fault = memoryFaultHook(uc, (recorded) => {
      this.#memoryFault = recorded;
    });
    this.#hooks.add(engine.hook_add(fault.type, fault.callback));
    startUserMode(parts);
    this.#registerGauges();
  }
  #registerGauges(): void {
    const { uc, translation } = this.#parts;
    const tier = translation?.tier;
    // The arena and translator tables are reserved up front; only pages that were used take memory.
    gauges.read(
      Gauge.WasmMemoryBytes,
      () =>
        uc.getTciMemory().buffer.byteLength -
        (tier ? tier.pages.region.bytes - this.memory.mappedPeak : 0),
    );
    gauges.read(Gauge.GuestMappedBytes, () => this.memory.mappedBytes);
    gauges.read(Gauge.GuestMappedPeak, () => this.memory.mappedPeak);
    gauges.read(Gauge.GuestCpuMs, () => this.#executed);
    gauges.read(Gauge.TranslatedFunctions, () => tier?.statistics.translatedFunctions ?? 0);
    gauges.read(Gauge.CodeFlushes, () => tier?.statistics.flushes ?? 0);
    gauges.read(Gauge.AotPrepared, () => tier?.statistics.aotPrepared ?? 0);
    gauges.read(Gauge.AotChunks, () => tier?.statistics.aotChunks ?? 0);
  }
  #excluded(pc: number): boolean {
    return this.#traps.some((t) => pc >= t.first && pc <= t.last + TRAP_GUARD);
  }
  #trapAt(pc: number): Trap | undefined {
    return this.#traps.find((t) => pc >= t.first && pc <= t.last);
  }
  get #bridge(): RegisterBridge | undefined {
    return this.#parts.translation?.bridge;
  }
  get compiler(): TciTierStatistics | undefined {
    return this.#parts.compiler?.statistics;
  }
  get translation(): TierStatistics | undefined {
    return this.#parts.translation?.tier.statistics;
  }
  get executedMilliseconds(): number {
    return this.#executed;
  }
  /** Part of executedMilliseconds spent in Unicorn rather than translated code. */
  get interpretedMilliseconds(): number {
    return this.#interpreted;
  }
  // Darwin ARM code reads its thread pointer from TPIDRURO. Unicorn includes
  // this register when saving and restoring a cooperative thread context.
  set threadPointer(address: number) {
    const { uc, registerTransfer } = this.#parts;
    registerTransfer.write(uc.ARM_REG_C13_C0_3, address);
    this.#bridge?.setThreadPointer(address);
  }
  #register(n: number): number {
    const id = Number.isInteger(n) && n >= 0 && n <= PC ? this.#parts.registers[n] : undefined;
    if (id === undefined) throw new RangeError("Expected register r0–r15");
    return id;
  }
  getReg(n: number): number {
    const bridge = this.#bridge;
    if (bridge?.translated) {
      this.#register(n);
      return bridge.get(n);
    }
    return this.#parts.registerTransfer.read(this.#register(n)) >>> 0;
  }
  setReg(n: number, value: number): void {
    const bridge = this.#bridge;
    if (bridge?.translated) {
      this.#register(n);
      bridge.set(n, value);
      return;
    }
    this.#parts.registerTransfer.write(this.#register(n), value >>> 0);
  }
  get cpsr(): number {
    const { uc, registerTransfer } = this.#parts;
    const bridge = this.#bridge;
    return bridge ? bridge.cpsr : registerTransfer.read(uc.ARM_REG_CPSR) >>> 0;
  }
  set cpsr(value: number) {
    const { uc, registerTransfer } = this.#parts;
    this.#bridge?.leave();
    registerTransfer.write(uc.ARM_REG_CPSR, value >>> 0);
  }
  get nextPC(): number {
    const bridge = this.#bridge;
    if (bridge?.translated) return bridge.pc;
    return (this.getReg(PC) + ((this.cpsr >>> THUMB_SHIFT) & 1)) >>> 0;
  }
  // Preserve the low bit when returning from a host call (ARM/Thumb interworking).
  branch(target: number): void {
    uint32(target, "target");
    const bridge = this.#bridge;
    if (bridge?.translated) bridge.pc = target;
    else this.#parts.registerTransfer.write(this.#parts.uc.ARM_REG_PC, target);
  }
  trap(address: number, fn: TrapHandler): () => void {
    const pc = uint32(address, "trap address") & ~1;
    return this.trapRange(pc >>> 0, pc >>> 0, fn);
  }
  trapRange(first: number, last: number, fn: TrapHandler): () => void {
    uint32(first, "first trap address");
    uint32(last, "last trap address");
    if (first > last || typeof fn !== "function")
      throw new TypeError("Invalid trap range or callback");
    const { uc, engine, blocks } = this.#parts;
    const record = { first, last, fn };
    this.#traps.push(record);
    const stop = (_: unknown, address: unknown): void => {
      this.#pending = { address: Number(address), fn };
      engine.emu_stop();
    };
    const hook = engine.hook_add(uc.HOOK_CODE, stop, null, first, last);
    this.#hooks.add(hook);
    blocks?.invalidateTraps();
    return () => {
      const at = this.#traps.indexOf(record);
      if (at >= 0) this.#traps.splice(at, 1);
      if (this.#hooks.delete(hook)) {
        engine.hook_del(hook);
        blocks?.invalidateTraps();
      }
    };
  }
  run(startPC = this.nextPC, { until = 0, count = DEFAULT_BUDGET }: RunLimits = {}): RunResult {
    uint32(startPC, "start PC");
    uint32(until, "stop address");
    if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_BUDGET)
      throw new RangeError("A positive instruction budget is required");
    this.#pending = null;
    this.#memoryFault = null;
    const before = performance.now();
    try {
      const translated = this.#enterTranslated(startPC, until, count);
      if (typeof translated !== "number") return translated;
      this.#interpret(translated, until, count);
    } catch (error) {
      throw this.#fault(error);
    } finally {
      this.#executed += performance.now() - before;
    }
    const pending = this.#takePending();
    if (pending) {
      pending.fn(this.facade, pending.address);
      return { reason: "trap", address: pending.address, pc: this.nextPC };
    }
    return { reason: this.getReg(PC) === until ? "until" : "budget", pc: this.nextPC };
  }
  #takePending(): Pending | null {
    const pending = this.#pending;
    this.#pending = null;
    return pending;
  }
  /** Runs translated code from `start`; returns the PC Unicorn continues at, or the result. */
  #enterTranslated(start: number, until: number, count: number): RunResult | number {
    const translation = this.#parts.translation;
    if (!translation) return start;
    const { tier, bridge } = translation;
    let pc = start;
    if (tier.entry(pc) && bridge.enter()) {
      const result = runTranslated(tier, bridge, pc, until, count);
      if (result.reason !== "fallback") return result;
      pc = result.pc;
      const trap = this.#trapAt(pc & ~1);
      if (trap) {
        trap.fn(this.facade, pc & ~1);
        return { reason: "trap", address: pc & ~1, pc: this.nextPC };
      }
    }
    tier.note(pc);
    bridge.leave();
    return pc;
  }
  #interpret(pc: number, until: number, count: number): void {
    const { engine, blocks } = this.#parts;
    if (blocks?.requiresRefresh(until)) {
      // Unicorn flushes translated blocks when removing its instruction-count hook.
      // Stop before guest execution while installing that hook, then remove it below.
      blocks.stop();
      engine.emu_start(pc, until, 0, 1);
    }
    blocks?.start(count, until);
    const interpreted = performance.now();
    try {
      engine.emu_start(pc, until, 0, blocks ? 0 : count);
    } finally {
      this.#interpreted += performance.now() - interpreted;
    }
  }
  #fault(cause: unknown): Error {
    const translated = !!this.#bridge?.translated;
    this.#failedWasm = cause instanceof WebAssembly.RuntimeError && !translated;
    let faultPC: number | undefined;
    try {
      faultPC = this.getReg(PC);
    } catch {
      // Preserve the original failure if Wasm already aborted.
    }
    const fault = this.#memoryFault;
    const address = fault ? ` accessing 0x${fault.faultAddress.toString(HEX)}` : "";
    const where = translated ? " in translated code" : "";
    const at = faultPC === undefined ? "" : ` at 0x${faultPC.toString(HEX)}`;
    const error = new Error(`Guest CPU fault${at}${where}${address}: ${String(cause)}`, { cause });
    return Object.assign(error, { pc: faultPC }, fault);
  }
  saveState(): UnicornState {
    const bridge = this.#bridge;
    const { uc, registerTransfer, states } = this.#parts;
    if (bridge?.translated)
      return {
        translated: bridge.save(),
        threadPointer: registerTransfer.read(uc.ARM_REG_C13_C0_3) >>> 0,
      };
    return { unicorn: states.save() };
  }
  restoreState(saved: UnicornState): void {
    const bridge = this.#bridge;
    if ("translated" in saved) {
      if (!bridge) throw new TypeError("Unknown CPU state.");
      bridge.restore(saved.translated);
      this.threadPointer = saved.threadPointer;
      return;
    }
    if (bridge) bridge.translated = false;
    this.#parts.states.restore(saved.unicorn);
  }
  freeState(saved: UnicornState): void {
    if ("unicorn" in saved) this.#parts.states.release(saved.unicorn);
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    // A trap in the Wasm engine itself can leave its internal allocator invalid.
    // Dropping the instance then releases all memory without running guest cleanup.
    if (this.#failedWasm) return;
    const { uc, engine, compiler, states, blocks, registerTransfer, transfer } = this.#parts;
    compiler?.close();
    states.close();
    blocks?.close();
    for (const hook of this.#hooks) engine.hook_del(hook);
    this.#hooks.clear();
    registerTransfer.close();
    uc._free(transfer);
    engine.close();
    this.#parts.translation?.tier.close();
  }
}
