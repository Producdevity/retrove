import type { StateLayout } from "../translation/layout";

const WORD_BYTES = 4;
const FLAG_COUNT = 4;
const FLAG_TOP_BIT = 31;
const PC = 15;
/** Core, flag and VFP registers occupy the first 512 bytes of the state block. */
const STATE_SPAN = 512;
const Cpsr = { User: 0x10, Thumb: 0x20, NonFlags: 0x0fffffff } as const;
/** Apple's ARMv7 runtime starts scalar floating point in RunFast mode (default NaN, flush to zero). */
const FPSCR_RUN_FAST = 0x0300_0000;

export interface SavedState {
  readonly bytes: Uint8Array;
  readonly pc: number;
  readonly cpsrBase: number;
}

/** Guest registers kept only in the translator's state block; translated code reads them in place. */
export class GuestState {
  /** Guest PC with the Thumb bit. */
  pc = 0;
  #cpsrBase: number = Cpsr.User;
  constructor(
    private readonly layout: () => StateLayout,
    private readonly view: () => DataView,
  ) {
    view().setUint32(layout().fpscr, FPSCR_RUN_FAST, true);
  }
  #flags(offset: number): number {
    const view = this.view();
    let flags = 0;
    for (let flag = 0; flag < FLAG_COUNT; flag++)
      flags |= view.getUint32(offset + WORD_BYTES * flag, true) << (FLAG_TOP_BIT - flag);
    return flags >>> 0;
  }
  get(register: number): number {
    if (register === PC) return (this.pc & ~1) >>> 0;
    return this.view().getUint32(this.layout().registers + WORD_BYTES * register, true);
  }
  set(register: number, value: number): void {
    if (register === PC) this.pc = value >>> 0;
    else this.view().setUint32(this.layout().registers + WORD_BYTES * register, value >>> 0, true);
  }
  get cpsr(): number {
    const thumb = this.pc & 1 ? Cpsr.Thumb : 0;
    return ((this.#cpsrBase & ~Cpsr.Thumb) | thumb | this.#flags(this.layout().flags)) >>> 0;
  }
  set cpsr(value: number) {
    const view = this.view(),
      flags = this.layout().flags;
    this.#cpsrBase = value & Cpsr.NonFlags;
    for (let flag = 0; flag < FLAG_COUNT; flag++)
      view.setUint32(flags + WORD_BYTES * flag, (value >>> (FLAG_TOP_BIT - flag)) & 1, true);
    this.pc = ((this.pc & ~1) | (value & Cpsr.Thumb ? 1 : 0)) >>> 0;
  }
  get threadPointer(): number {
    return this.view().getUint32(this.layout().tls, true);
  }
  set threadPointer(address: number) {
    this.view().setUint32(this.layout().tls, address >>> 0, true);
  }
  save(): SavedState {
    const base = this.layout().registers,
      bytes = new Uint8Array(this.view().buffer, base, STATE_SPAN).slice();
    return { bytes, pc: this.pc, cpsrBase: this.#cpsrBase };
  }
  /** A thread switch clears the exclusive monitor, as the kernel does with CLREX. */
  restore(saved: SavedState): void {
    new Uint8Array(this.view().buffer, this.layout().registers, STATE_SPAN).set(saved.bytes);
    this.view().setUint32(this.layout().exclusiveAddress, 0, true);
    this.pc = saved.pc;
    this.#cpsrBase = saved.cpsrBase;
  }
}
