import {read32} from './memory.mjs';
import {GuestLandingPad} from './sjlj.mjs';

// The ARMv7 Darwin jmp_buf is 112 bytes. Store r4-r11, sp/lr and d8-d15
// in guest memory so copies preserve their exact integer and floating-point bits.
// The guest supports an empty signal mask. The final word preserves its SjLj chain.
const save = [
  0xe8800ff0, 0xe580d020, 0xe580e024, // stmia r0,{r4-r11}; save sp,lr
  0xe280c028, 0xec8c8b10,            // add ip,r0,#40; vstmia ip,{d8-d15}
  0xe3a01000, 0xe5801068,            // store signal mask at +104
  0xee1d1f70, 0xe5111004, 0xe580106c,// save TLS SjLj context at +108
  0xe3a00000, 0xe12fff1e             // return zero
];
const resume = [
  0xe1a0c000, 0xee1d2f70, 0xe59c306c, 0xe5023004, // restore TLS chain
  0xe89c0ff0, 0xe59cd020, 0xe59ce024,             // restore r4-r11, sp, lr
  0xe28c2028, 0xec928b10,                         // restore d8-d15
  0xe1b00001, 0x03a00001, 0xe12fff1e              // return value, converting zero to one
];

export function nonlocalJumps(cpu,heap,threads){
  const base=heap.alloc(4096,4096);if(!base)throw Error('Unable to allocate setjmp helpers');
  const words=new Uint8Array(4*(save.length+resume.length)),v=new DataView(words.buffer);
  [...save,...resume].forEach((word,i)=>v.setUint32(i*4,word,true));
  cpu.write(base,words);cpu.protect(base,4096,5);
  const trampoline=base+4*save.length;
  class LongJump extends GuestLandingPad {
    constructor(buffer,value){super(trampoline,0,read32(cpu,buffer+32),threads.funcs._pthread_self());this.buffer=buffer;this.value=value;}
    restore(cpu){cpu.setReg(0,this.buffer);cpu.setReg(1,this.value);return this.pc;}
  }
  return {save:base,longjmp:a=>new LongJump(a(0),a(1))};
}
