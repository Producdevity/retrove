import type { GuestHeap } from "../ios/libc/guest-imports";
import type { GuestArguments } from "../ios/objc/host";
import type { GuestMemory } from "../memory/guest-memory";
import { ExceptionMatcher } from "./exception-matcher";
import type { GuestLandingPad } from "./landing-pad";
import { SjljRuntime, type SjljUnwind } from "./sjlj-runtime";
import { CxxTypeInfo, type TypeInfoGate } from "./type-info";

export { GuestLandingPad } from "./landing-pad";
export type { SjljUnwind, UnwindThreads } from "./sjlj-runtime";
export type { ExceptionObjc } from "./exception-matcher";

const Arg = { First: 0, Second: 1, Third: 2 } as const;
const VECTOR_ERRORS = [
  ["length_error", "St12length_error"],
  ["out_of_range", "St12out_of_range"],
] as const;
const MESSAGE_ERRORS = [
  "St11logic_error",
  "St12length_error",
  "St12out_of_range",
  "St16invalid_argument",
  "St12domain_error",
  "St13runtime_error",
  "St11range_error",
  "St14overflow_error",
  "St15underflow_error",
] as const;

export type SjljImport = (a: GuestArguments) => number | void | GuestLandingPad | Promise<void>;
export interface SjljExceptions {
  readonly funcs: Record<string, SjljImport>;
  readonly data: Map<string, number>;
  raiseStandard(name: string, message?: number): GuestLandingPad;
  objcType(name: string, cls?: number): number;
  throwObjC(object: number, uncaught: () => Promise<void>): Promise<GuestLandingPad>;
}

function exceptionImports(runtime: SjljRuntime): Record<string, SjljImport> {
  const funcs: Record<string, SjljImport> = {
    ___cxa_allocate_exception: (a) => runtime.allocate(a(Arg.First)),
    ___cxa_free_exception: (a) => runtime.free(a(Arg.First)),
    ___cxa_throw: (a) => runtime.throw(a(Arg.First), a(Arg.Second), a(Arg.Third)),
    ___cxa_begin_catch: (a) => runtime.beginCatch(a(Arg.First)),
    ___cxa_end_catch: () => runtime.endCatch(),
    ___cxa_rethrow: () => runtime.rethrow(),
    ___cxa_call_unexpected: () => {
      throw new Error("Guest C++ exception violated a dynamic exception specification");
    },
    __Unwind_SjLj_Resume: (a) => runtime.resume(runtime.exceptionFor(a(Arg.First))),
    ___gxx_personality_sj0: (a) => runtime.personality(a),
  };
  for (const [suffix, name] of VECTOR_ERRORS)
    funcs[`__ZNKSt3__120__vector_base_commonILb1EE20__throw_${suffix}Ev`] = () =>
      runtime.raiseStandard(name);
  funcs["__ZSt17__throw_bad_allocv"] = () => runtime.raiseStandard("St9bad_alloc");
  for (const name of MESSAGE_ERRORS) {
    const helper = `__throw_${name.replace(/^St\d+/, "")}`;
    funcs[`__ZSt${helper.length}${helper}PKc`] = (a) => runtime.raiseStandard(name, a(Arg.First));
  }
  const alias = (from: string, to: string): void => {
    const implementation = funcs[from];
    if (implementation) funcs[to] = implementation;
  };
  alias("___gxx_personality_sj0", "___objc_personality_v0");
  alias("___cxa_begin_catch", "_objc_begin_catch");
  alias("___cxa_end_catch", "_objc_end_catch");
  alias("___cxa_rethrow", "_objc_exception_rethrow");
  return funcs;
}

/** C++ and Objective-C exceptions over Clang's ARMv7 Darwin SjLj unwinding. */
export function sjljExceptions(
  cpu: GuestMemory,
  heap: GuestHeap,
  unwind: SjljUnwind,
): SjljExceptions {
  const gate: TypeInfoGate = (name, fn) => unwind.hostGate({ library: "libc++abi", name }, fn);
  const nop = gate("type_info destructor", () => 0);
  const deleting = gate("type_info deleting destructor", (a) => heap.free(a(Arg.First)));
  const canCatch = gate("type_info::can_catch", (a) => matcher.canCatch(a));
  const types = new CxxTypeInfo(cpu, heap, gate, { nop, deleting, canCatch });
  const matcher = new ExceptionMatcher(cpu, types, unwind.objc);
  const runtime = new SjljRuntime(cpu, heap, unwind, types, matcher);
  return {
    funcs: exceptionImports(runtime),
    data: types.data,
    raiseStandard: (name, message) => runtime.raiseStandard(name, message),
    objcType: (name, cls) => types.objcType(name, cls),
    throwObjC: (object, uncaught) => runtime.throwObjC(object, uncaught),
  };
}
