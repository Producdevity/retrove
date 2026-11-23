import type { GuestCPU } from "../cpu/cpu";

const FRAME_POINTER = 7;
const STACK_POINTER = 13;

/** A guest control transfer that unwinds host frames until the owning thread's stack is active. */
export class GuestLandingPad {
  constructor(
    readonly pc: number,
    readonly fp: number,
    readonly sp: number,
    readonly thread: number,
  ) {}
  /** Restores the registers the guest compiler recorded; returns the PC to resume at. */
  restore(cpu: Pick<GuestCPU, "setReg">): number {
    cpu.setReg(FRAME_POINTER, this.fp);
    cpu.setReg(STACK_POINTER, this.sp);
    return this.pc;
  }
}
