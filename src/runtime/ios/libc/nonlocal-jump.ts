import type { GuestCPU } from "../../cpu/cpu";
import { GuestLandingPad } from "../../cxx/landing-pad";
import type { UnwindThreads } from "../../cxx/sjlj";
import { read32 } from "../../memory/guest-memory";
import type { GuestArguments } from "../objc/host";
import type { GuestHeap } from "./guest-imports";

const PAGE = 4096;
const READ_EXECUTE = 5;
const WORD_BYTES = 4;
/** jmp_buf word holding the saved sp. */
const SAVED_SP = 32;
const Arg = { Buffer: 0, Value: 1 } as const;
const Register = { Buffer: 0, Value: 1 } as const;

// The ARMv7 Darwin jmp_buf is 112 bytes. Store r4-r11, sp/lr and d8-d15
// in guest memory so copies preserve their exact integer and floating-point bits.
// The guest supports an empty signal mask. The final word preserves its SjLj chain.
const Save = {
  StoreCore: 0xe8800ff0, // stmia r0,{r4-r11}
  StoreSp: 0xe580d020, // str sp,[r0,#32]
  StoreLr: 0xe580e024, // str lr,[r0,#36]
  VfpBase: 0xe280c028, // add ip,r0,#40
  StoreVfp: 0xec8c8b10, // vstmia ip,{d8-d15}
  ZeroMask: 0xe3a01000, // mov r1,#0
  StoreMask: 0xe5801068, // str r1,[r0,#104]
  ReadTls: 0xee1d1f70, // mrc p15,0,r1,c13,c0,3
  LoadChain: 0xe5111004, // ldr r1,[r1,#-4]
  StoreChain: 0xe580106c, // str r1,[r0,#108]
  ReturnZero: 0xe3a00000, // mov r0,#0
  Return: 0xe12fff1e, // bx lr
} as const;
const Resume = {
  CopyBuffer: 0xe1a0c000, // mov ip,r0
  ReadTls: 0xee1d2f70, // mrc p15,0,r2,c13,c0,3
  LoadChain: 0xe59c306c, // ldr r3,[ip,#108]
  StoreChain: 0xe5023004, // str r3,[r2,#-4]
  LoadCore: 0xe89c0ff0, // ldmia ip,{r4-r11}
  LoadSp: 0xe59cd020, // ldr sp,[ip,#32]
  LoadLr: 0xe59ce024, // ldr lr,[ip,#36]
  VfpBase: 0xe28c2028, // add r2,ip,#40
  LoadVfp: 0xec928b10, // vldmia r2,{d8-d15}
  MoveValue: 0xe1b00001, // movs r0,r1
  ZeroToOne: 0x03a00001, // moveq r0,#1
  Return: 0xe12fff1e, // bx lr
} as const;
const SAVE_CODE: readonly number[] = Object.values(Save);
const RESUME_CODE: readonly number[] = Object.values(Resume);

export interface NonlocalJumps {
  /** setjmp: guest code that records the caller's state and returns zero. */
  readonly save: number;
  readonly longjmp: (a: GuestArguments) => GuestLandingPad;
}

/** setjmp/longjmp: the jump unwinds host frames like a C++ landing pad, then resumes guest code. */
export function nonlocalJumps(
  cpu: Pick<GuestCPU, "read" | "read32" | "write" | "protect">,
  heap: Pick<GuestHeap, "alloc">,
  threads: Pick<UnwindThreads, "funcs">,
): NonlocalJumps {
  const base = heap.alloc(PAGE, PAGE);
  if (!base) throw new Error("Unable to allocate setjmp helpers");
  const code = [...SAVE_CODE, ...RESUME_CODE];
  const words = new Uint8Array(WORD_BYTES * code.length),
    view = new DataView(words.buffer);
  code.forEach((word, i) => view.setUint32(i * WORD_BYTES, word, true));
  cpu.write(base, words);
  cpu.protect(base, PAGE, READ_EXECUTE);
  const trampoline = base + WORD_BYTES * SAVE_CODE.length;
  class LongJump extends GuestLandingPad {
    constructor(
      readonly buffer: number,
      readonly value: number,
    ) {
      super(trampoline, 0, read32(cpu, buffer + SAVED_SP), threads.funcs._pthread_self());
    }
    override restore(target: Pick<GuestCPU, "setReg">): number {
      target.setReg(Register.Buffer, this.buffer);
      target.setReg(Register.Value, this.value);
      return this.pc;
    }
  }
  return { save: base, longjmp: (a) => new LongJump(a(Arg.Buffer), a(Arg.Value)) };
}
