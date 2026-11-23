import type { GuestHeap } from "../ios/libc/guest-imports";
import { pureMathImports } from "../ios/libc/pure-math";
import type { GuestArguments } from "../ios/objc/host";
import { read32, readCStringBytes, write32, type GuestMemory } from "../memory/guest-memory";
import { memoryMathImports } from "./cxx-math";
import { CowStrings, EMPTY_REP_SYMBOL, gnuStringImports } from "./gnu-string";
import { gnuContainerImports } from "./gnu-tree";
import type { GuestLandingPad } from "./landing-pad";
import { randomShuffleImports } from "./random-shuffle";
import { sjljExceptions, type SjljExceptions, type SjljUnwind } from "./sjlj";

const WORD_BITS = 32;
const Arg = { First: 0, Second: 1, Third: 2 } as const;

export type CxxImport = (a: GuestArguments) => unknown;
export type CxxImports = Partial<
  Pick<SjljExceptions, "raiseStandard" | "objcType" | "throwObjC">
> & {
  readonly funcs: Record<string, CxxImport>;
  readonly data: Map<string, number>;
};

function decimal(cpu: GuestMemory, pointer: number): number {
  const match = /^\s*[+-]?[0-9]+/.exec(new TextDecoder().decode(readCStringBytes(cpu, pointer)));
  return match ? Number(BigInt.asUintN(WORD_BITS, BigInt(match[0].trim()))) : 0;
}

function exactDivide(a: number, b: number): number {
  if (!b) throw new Error("Guest integer division by zero");
  return Math.trunc(a / b);
}

function runtimeImports(
  cpu: GuestMemory,
  heap: Pick<GuestHeap, "alloc">,
  currentThread: () => number,
  exceptions: SjljExceptions | undefined,
): Record<string, CxxImport> {
  const top = new Map<number, number>();
  const newObject = (a: GuestArguments): number | GuestLandingPad => {
    const ptr = heap.alloc(Math.max(1, a(Arg.First)));
    if (!ptr && exceptions) return exceptions.raiseStandard("St9bad_alloc");
    if (!ptr)
      throw new Error("C++ operator new exhausted guest memory (bad_alloc unwinding unsupported)");
    return ptr;
  };
  return {
    __Znwm: newObject,
    __Znam: newObject,
    __Unwind_SjLj_Register: (a) => {
      const thread = currentThread(),
        p = a(Arg.First);
      write32(cpu, p, top.get(thread) ?? 0);
      top.set(thread, p);
    },
    __Unwind_SjLj_Unregister: (a) => {
      const thread = currentThread(),
        p = a(Arg.First);
      if (top.get(thread) !== p) throw new Error("Guest SJLJ context stack is inconsistent");
      const previous = read32(cpu, p);
      if (previous) top.set(thread, previous);
      else top.delete(thread);
    },
    ___cxa_pure_virtual: () => {
      throw new Error("Guest called a pure virtual method");
    },
    __ZSt9terminatev: () => {
      throw new Error("Guest called std::terminate()");
    },
    ___divmodsi4: (a) => {
      const x = a(Arg.First) | 0,
        y = a(Arg.Second) | 0,
        q = exactDivide(x, y);
      write32(cpu, a(Arg.Third), (x - q * y) >>> 0);
      return q >>> 0;
    },
    _atoi: (a) => decimal(cpu, a(Arg.First)),
    // long is 32 bits on ARMv6, so atol shares atoi's result.
    _atol: (a) => decimal(cpu, a(Arg.First)),
  };
}

/** libc++/libstdc++ runtime support, libm helpers and, given an unwinder, C++ exceptions. */
export function cxxImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  currentThread: () => number = () => 1,
  unwind?: SjljUnwind,
): CxxImports {
  const exceptions = unwind && sjljExceptions(cpu, heap, unwind);
  const funcs: Record<string, CxxImport> = runtimeImports(cpu, heap, currentThread, exceptions);
  // libm and compiler-rt functions of their arguments alone; execution workers run the same ones.
  Object.assign(
    funcs,
    pureMathImports(),
    memoryMathImports(cpu),
    randomShuffleImports(currentThread),
  );
  const data = exceptions?.data ?? new Map<string, number>();
  const words = {
    read: (p: number) => read32(cpu, p),
    write: (p: number, x: number) => write32(cpu, p, x),
  };
  const strings = new CowStrings({
    ...words,
    readBytes: (p, n) => cpu.read(p, n),
    writeBytes: (p, bytes) => cpu.write(p, bytes),
    allocate: (n) => heap.alloc(n),
    free: (p) => heap.free(p),
    zero: (n) => heap.zero(n),
    lengthError: (message) => {
      if (!exceptions) throw new Error("std::length_error: " + message);
      return exceptions.raiseStandard("St12length_error", heap.string(message));
    },
  });
  data.set(EMPTY_REP_SYMBOL, strings.emptyRep);
  Object.assign(funcs, gnuContainerImports(words), gnuStringImports(strings));
  return { ...exceptions, funcs: Object.assign(funcs, exceptions?.funcs), data };
}
