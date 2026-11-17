import type { StateLayout } from "./layout";

const WORD_BYTES = 4;
const DOUBLE_BYTES = 8;
const CORE_REGISTERS = 15;
const DOUBLE_REGISTERS = 32;
const FLAG_COUNT = 4;
const FLAG_TOP_BIT = 31;
const PC = 15;
/** Core, flag and VFP registers occupy the first 512 bytes of the state block. */
const STATE_SPAN = 512;
const Cpsr = {
  Thumb: 0x20,
  /** IT state and the Q/GE bits cannot be represented in the translated state block. */
  Unrepresentable: 0x0600fc00,
  NonFlags: 0x0fffffff,
} as const;
const RunFast = { Mask: 0x03c00000, Value: 0x03000000 } as const;
export interface BridgeModule {
  _uc_reg_read(engine: number, register: number, destination: number): number;
  _uc_reg_write(engine: number, register: number, source: number): number;
  readonly ERR_OK: number;
  strerror(status: number): string;
}
export interface BridgeRegisters {
  read(register: number): number;
  write(register: number, value: number): void;
}
export interface RegisterIds {
  readonly core: readonly number[];
  readonly doubles: readonly number[];
  readonly cpsr: number;
  readonly fpscr: number;
  readonly pc: number;
  readonly threadPointer: number;
}
/** Which engine holds the authoritative guest registers, and the transfers between them. */
export class RegisterBridge {
  translated = false;
  /** Guest PC with the Thumb bit while translated code owns the registers. */
  pc = 0;
  #cpsrBase = 0;
  readonly #module: BridgeModule;
  readonly #engine: number;
  readonly #registers: BridgeRegisters;
  readonly #ids: RegisterIds;
  readonly #layout: () => StateLayout;
  readonly #view: () => DataView;
  constructor(
    module: BridgeModule,
    engine: number,
    registers: BridgeRegisters,
    ids: RegisterIds,
    layout: () => StateLayout,
    view: () => DataView,
  ) {
    this.#module = module;
    this.#engine = engine;
    this.#registers = registers;
    this.#ids = ids;
    this.#layout = layout;
    this.#view = view;
  }
  #check(status: number): void {
    if (status !== this.#module.ERR_OK)
      throw new Error(`Guest register transfer failed: ${this.#module.strerror(status)}`);
  }
  #transfer(write: boolean): void {
    const layout = this.#layout(),
      module = this.#module,
      engine = this.#engine;
    const move = (id: number, address: number): void => {
      this.#check(
        write
          ? module._uc_reg_write(engine, id, address)
          : module._uc_reg_read(engine, id, address),
      );
    };
    this.#ids.core.slice(0, CORE_REGISTERS).forEach((id, index) => {
      move(id, layout.registers + WORD_BYTES * index);
    });
    this.#ids.doubles.slice(0, DOUBLE_REGISTERS).forEach((id, index) => {
      move(id, layout.vfp + DOUBLE_BYTES * index);
    });
  }
  /** Moves registers into the translated state block; false when the state cannot be represented. */
  enter(): boolean {
    if (this.translated) return true;
    const cpsr = this.#registers.read(this.#ids.cpsr) >>> 0,
      fpscr = this.#registers.read(this.#ids.fpscr) >>> 0;
    if (cpsr & Cpsr.Unrepresentable || (fpscr & RunFast.Mask) !== RunFast.Value) return false;
    this.#transfer(false);
    const layout = this.#layout(),
      view = this.#view();
    for (let flag = 0; flag < FLAG_COUNT; flag++) {
      view.setUint32(layout.flags + WORD_BYTES * flag, (cpsr >>> (FLAG_TOP_BIT - flag)) & 1, true);
      view.setUint32(
        layout.fpFlags + WORD_BYTES * flag,
        (fpscr >>> (FLAG_TOP_BIT - flag)) & 1,
        true,
      );
    }
    view.setUint32(layout.fpscr, fpscr, true);
    view.setUint32(layout.tls, this.#registers.read(this.#ids.threadPointer) >>> 0, true);
    this.#cpsrBase = cpsr & Cpsr.NonFlags;
    this.pc = (this.#registers.read(this.#ids.pc) | (cpsr & Cpsr.Thumb ? 1 : 0)) >>> 0;
    this.translated = true;
    return true;
  }
  #flags(offset: number): number {
    const view = this.#view();
    let flags = 0;
    for (let flag = 0; flag < FLAG_COUNT; flag++)
      flags |= view.getUint32(offset + WORD_BYTES * flag, true) << (FLAG_TOP_BIT - flag);
    return flags >>> 0;
  }
  /** Moves registers back to Unicorn. */
  leave(): void {
    if (!this.translated) return;
    const layout = this.#layout();
    this.#transfer(true);
    this.#registers.write(this.#ids.cpsr, this.cpsr);
    const fpscr = this.#view().getUint32(layout.fpscr, true) & Cpsr.NonFlags;
    this.#registers.write(this.#ids.fpscr, (fpscr | this.#flags(layout.fpFlags)) >>> 0);
    this.#registers.write(this.#ids.pc, (this.pc & ~1) >>> 0);
    this.translated = false;
  }
  get cpsr(): number {
    if (!this.translated) return this.#registers.read(this.#ids.cpsr) >>> 0;
    return (
      ((this.#cpsrBase & ~Cpsr.Thumb) |
        (this.pc & 1 ? Cpsr.Thumb : 0) |
        this.#flags(this.#layout().flags)) >>>
      0
    );
  }
  get(register: number): number {
    if (register === PC) return (this.pc & ~1) >>> 0;
    return this.#view().getUint32(this.#layout().registers + WORD_BYTES * register, true);
  }
  set(register: number, value: number): void {
    if (register === PC) this.pc = value >>> 0;
    else
      this.#view().setUint32(this.#layout().registers + WORD_BYTES * register, value >>> 0, true);
  }
  setThreadPointer(address: number): void {
    this.#view().setUint32(this.#layout().tls, address >>> 0, true);
  }
  /** The state block holds every translated register; saving it captures a translated thread. */
  save(): { bytes: Uint8Array; pc: number; cpsrBase: number } {
    const base = this.#layout().registers,
      bytes = new Uint8Array(this.#view().buffer, base, STATE_SPAN).slice();
    return { bytes, pc: this.pc, cpsrBase: this.#cpsrBase };
  }
  restore(saved: {
    readonly bytes: Uint8Array;
    readonly pc: number;
    readonly cpsrBase: number;
  }): void {
    new Uint8Array(this.#view().buffer, this.#layout().registers, STATE_SPAN).set(saved.bytes);
    this.pc = saved.pc;
    this.#cpsrBase = saved.cpsrBase;
    this.translated = true;
  }
}
