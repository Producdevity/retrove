import type { ThreadCpu, ThreadHeap } from "./thread-types";

const PAGE = 4096;
const READ_EXECUTE = 5;
const WORD_BYTES = 4;
// Stackless ARM leaves are callable from ARM or Thumb without crossing into
// JavaScript. Register and unregister are used by each C++ cleanup scope.
const Register = {
  ReadTls: 0xee1d1f70, // mrc p15, 0, r1, c13, c0, 3  (TPIDRURO)
  LoadChain: 0xe5112004, // ldr r2, [r1, #-4]
  LinkPrevious: 0xe5802000, // str r2, [r0]
  StoreChain: 0xe5010004, // str r0, [r1, #-4]
  Return: 0xe12fff1e, // bx lr
} as const;
const Unregister = {
  ReadTls: 0xee1d1f70, // mrc p15, 0, r1, c13, c0, 3
  LoadPrevious: 0xe5902000, // ldr r2, [r0]
  StoreChain: 0xe5012004, // str r2, [r1, #-4]
  Return: 0xe12fff1e, // bx lr
} as const;
const Self = {
  ReadTls: 0xee1d0f70, // mrc p15, 0, r0, c13, c0, 3
  LoadSelf: 0xe5900000, // ldr r0, [r0]
  Return: 0xe12fff1e, // bx lr
} as const;
const GetSpecific = {
  ReadTls: 0xee1d1f70, // mrc p15, 0, r1, c13, c0, 3
  CompareKey: 0xe3500c02, // cmp r0, #512
  LoadTable: 0xe5911004, // ldr r1, [r1, #4]
  LoadValue: 0x37910100, // ldrlo r0, [r1, r0, lsl #2]
  ZeroValue: 0x23a00000, // movhs r0, #0
  Return: 0xe12fff1e, // bx lr
} as const;
const LEAVES = [
  ["__Unwind_SjLj_Register", Object.values(Register)],
  ["__Unwind_SjLj_Unregister", Object.values(Unregister)],
  ["_pthread_self", Object.values(Self)],
  ["_pthread_getspecific", Object.values(GetSpecific)],
] as const;

/** Installs the ARM thread leaves on one read-execute page; returns their addresses by symbol. */
export function threadFunctions(cpu: ThreadCpu, heap: ThreadHeap): Map<string, number> {
  const code = heap.alloc(PAGE, PAGE);
  if (!code) throw Error("Guest heap exhausted installing thread functions");
  const instructions: number[] = LEAVES.flatMap(([, words]) => words);
  const view = new DataView(new ArrayBuffer(instructions.length * WORD_BYTES));
  instructions.forEach((op, i) => view.setUint32(i * WORD_BYTES, op, true));
  cpu.write(code, new Uint8Array(view.buffer));
  cpu.protect(code, PAGE, READ_EXECUTE);
  const functions = new Map<string, number>();
  let at = code;
  for (const [name, words] of LEAVES) {
    functions.set(name, at);
    at += words.length * WORD_BYTES;
  }
  return functions;
}
