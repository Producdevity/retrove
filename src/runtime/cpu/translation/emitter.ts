import { WordBytes, type InstructionSize } from "./bits";
import type { Instruction } from "./instruction";
import type { StateLayout } from "./layout";
import type { FunctionRange, TranslationInput } from "./translation-types";
import { Code } from "./wasm-code";
import { Type } from "./wasm-opcodes";
import { CachedRegisters } from "./state-helpers";

/** Decoded instruction at a function address; `itStart` marks instructions inside an IT block. */
export interface Decoded {
  readonly address: number;
  readonly size: InstructionSize;
  readonly instruction: Instruction;
  readonly itStart?: number;
}

/** Cached N, Z, C, V bits, one i32 local each. */
export interface FlagLocals {
  readonly n: number;
  readonly z: number;
  readonly c: number;
  readonly v: number;
}

type Eight = readonly [number, number, number, number, number, number, number, number];
type Four = readonly [number, number, number, number];
type Three = readonly [number, number, number];

const Locals = { Registers: CachedRegisters, LaneTemps: 8 } as const;
/** The single Wasm parameter is the guest PC to enter at. */
export const EntryParameter = 0;
const Parameters = 1;
const Mode = { ThumbBit: 1, ArmAlignment: 3, ThumbPipeline: 4, ArmPipeline: 8 } as const;
const LabelSlotBytes = 2;
const NoLabel = -1;

/** Per-function emission state: the Wasm locals that cache guest state and the control-flow bookkeeping. */
export class Emitter {
  readonly c = new Code(Parameters);
  readonly registers: readonly number[];
  readonly flags: FlagLocals;
  readonly fpFlags: FlagLocals;
  readonly label: number;
  readonly exitPC: number;
  readonly exitKind: number;
  readonly hostTemp: number;
  readonly log: { readonly value: number; readonly host: number; readonly at: number } | undefined;
  readonly t: Eight;
  readonly x: Four;
  readonly f: Three;
  /** Unused f32 locals, kept so emitted modules stay byte-identical to the reference spike translator. */
  readonly g: Three;
  readonly laneTemps: readonly number[];
  readonly lanes = new Map<number, number>();
  readonly scratchLanes = new Map<number, number>();
  readonly labels: Int32Array;
  readonly leaders = new Map<number, number>();
  readonly budgetPoints = new Set<number>();
  readonly jumpTargets = new Set<number>();
  readonly unsupportedLeaders: number[] = [];
  readonly itExits = new Set<number>();
  readonly at = new Map<number, Decoded>();
  readonly thumb: boolean;
  readonly base: number;
  unsupported = 0;
  size: InstructionSize = WordBytes;
  itStart: number | undefined;
  debugPC = 0;

  constructor(
    readonly range: FunctionRange,
    readonly decoded: readonly Decoded[],
    readonly labelAddress: number,
    readonly input: TranslationInput,
    readonly functionIndex: (address: number) => number | undefined,
  ) {
    const i32 = () => this.c.local(Type.I32);
    const flags = (): FlagLocals => ({ n: i32(), z: i32(), c: i32(), v: i32() });
    this.registers = Array.from({ length: Locals.Registers }, i32);
    this.flags = flags();
    this.fpFlags = flags();
    this.label = i32();
    this.exitPC = i32();
    this.exitKind = i32();
    this.hostTemp = i32();
    this.log = input.debug ? { value: i32(), host: i32(), at: i32() } : undefined;
    this.t = [i32(), i32(), i32(), i32(), i32(), i32(), i32(), i32()];
    const i64 = () => this.c.local(Type.I64),
      f64 = () => this.c.local(Type.F64),
      f32 = () => this.c.local(Type.F32);
    this.x = [i64(), i64(), i64(), i64()];
    this.f = [f64(), f64(), f64()];
    this.g = [f32(), f32(), f32()];
    this.laneTemps = Array.from({ length: Locals.LaneTemps }, i32);
    this.thumb = (range.start & Mode.ThumbBit) === Mode.ThumbBit;
    this.base = range.start & ~Mode.ThumbBit;
    this.labels = new Int32Array((range.end - this.base) / LabelSlotBytes).fill(NoLabel);
    for (const entry of decoded) this.at.set(entry.address, entry);
  }

  get L(): StateLayout {
    return this.input.layout;
  }

  /** Local caching general register `n` (R0-R14). */
  register(n: number): number {
    const local = this.registers[n];
    if (local === undefined) throw new RangeError("No cached local for register " + n);
    return local;
  }

  /** Lane temporary `k`; a missing slot fails translation like an invalid local index. */
  laneTemp(k: number): number {
    const local = this.laneTemps[k];
    if (local === undefined) throw new RangeError("No lane temporary " + k);
    return local;
  }

  /** Guest PC value for `address` in this function's instruction set. */
  mode(address: number): number {
    return this.thumb ? (address | Mode.ThumbBit) >>> 0 : address;
  }

  /** PC as read by an instruction at `pc`. */
  pcValue(pc: number): number {
    return this.thumb ? pc + Mode.ThumbPipeline : pc + Mode.ArmPipeline;
  }

  /** Base for PC-relative literal addressing. */
  literalBase(pc: number): number {
    return this.thumb ? (pc + Mode.ThumbPipeline) & ~Mode.ArmAlignment : pc + Mode.ArmPipeline;
  }

  /** Alignment mask and expected low bits of a guest PC in this function's instruction set. */
  modeBits(): { readonly mask: number; readonly value: number } {
    return this.thumb
      ? { mask: Mode.ThumbBit, value: Mode.ThumbBit }
      : { mask: Mode.ArmAlignment, value: 0 };
  }

  /** In-function address for a branch target with mode bit, or undefined when it leaves the function or changes mode. */
  local(target: number): number | undefined {
    if (((target & Mode.ThumbBit) === Mode.ThumbBit) !== this.thumb) return undefined;
    const address = target & ~Mode.ThumbBit;
    return this.inside(address) ? address : undefined;
  }

  inside(address: number): boolean {
    const alignment = this.thumb ? Mode.ThumbBit : Mode.ArmAlignment;
    return (
      address >= this.base &&
      address < this.range.end &&
      (address & alignment) === 0 &&
      this.at.has(address)
    );
  }

  /** Label table slot of `address`. */
  slot(address: number): number {
    return (address - this.base) / LabelSlotBytes;
  }
}
