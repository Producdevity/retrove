const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
const WORD_BYTES = 4;
/**
 * glGetError as ARM code: returns GL_NO_ERROR from a guest flag word without leaving translated
 * code, and jumps to the host gate only when an error is pending or a driver check is due.
 */
const Arm = {
  LoadFlagAddress: 0xe59f000c, // ldr r0, [pc, #12]
  LoadFlag: 0xe5900000, // ldr r0, [r0]
  CompareZero: 0xe3500000, // cmp r0, #0
  ReturnIfZero: 0x012fff1e, // bxeq lr: GL_NO_ERROR
  JumpToGate: 0xe59ff000, // ldr pc, [pc, #0]
} as const;
const CODE = [
  Arm.LoadFlagAddress,
  Arm.LoadFlag,
  Arm.CompareZero,
  Arm.ReturnIfZero,
  Arm.JumpToGate,
] as const;

interface GuestMemory {
  write(address: number, bytes: Uint8Array): void;
  protect(address: number, size: number, permissions: number): void;
}
interface GuestHeap {
  alloc(size: number, alignment: number): number;
}

/** Installs the check and returns its address, or 0 when the heap has no page for it. */
export function guestErrorCheck(
  memory: GuestMemory,
  heap: GuestHeap,
  flag: number,
  hostGate: number,
): number {
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!base) return 0;
  const words = [...CODE, flag, hostGate];
  const view = new DataView(new ArrayBuffer(words.length * WORD_BYTES));
  words.forEach((word, index) => view.setUint32(index * WORD_BYTES, word >>> 0, true));
  memory.write(base, new Uint8Array(view.buffer));
  memory.protect(base, PAGE_BYTES, READ_EXECUTE);
  return base;
}
