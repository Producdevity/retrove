import type { GuestHeap } from "../ios/libc/guest-imports";
import type { GuestArguments } from "../ios/objc/host";
import type { GuestCall, HostGate } from "../ios/objc/runtime-types";
import { read32, write32, type GuestMemory } from "../memory/guest-memory";
import { callSite, Frame, type CallSite } from "./exception-table";
import type { ExceptionMatcher, ExceptionObjc } from "./exception-matcher";
import { GuestLandingPad } from "./landing-pad";
import type { CxxTypeInfo } from "./type-info";

/** Bytes before each thrown object; the guest passes this header address to the unwinder. */
export const EXCEPTION_HEADER = 32;
const RESERVE_BYTES = 256;
const STANDARD_OBJECT_BYTES = 8;
const WORD_BYTES = 4;
const HEX = 16;
const UNCAUGHT_OBJC = "Uncaught guest Objective-C exception";
const Personality = { Version: 0, Actions: 1, Exception: 4, Context: 5 } as const;
const PERSONALITY_VERSION = 1;
const Action = { Search: 1, Cleanup: 2, HandlerFrame: 4 } as const;
const Reason = { FatalPhase1: 3, HandlerFound: 6, InstallContext: 7, ContinueUnwind: 8 } as const;

export interface UnwindThreads {
  readonly funcs: { readonly _pthread_self: () => number };
  /** The current thread's top SjLj function context. */
  unwindTop: number;
}
export interface SjljUnwind {
  readonly threads: UnwindThreads;
  readonly nested: GuestCall;
  readonly hostGate: HostGate;
  readonly objc: () => ExceptionObjc;
}
type Pad = CallSite & { readonly frame: number };
interface GuestException {
  readonly object: number;
  readonly header: number;
  handlers: number;
  type: number;
  destroy: number;
  objcObject?: number;
  pads: Pad[];
  adjusted: number | undefined;
}

/** Thrown exceptions, the catch stack of each guest thread and the two-phase SjLj unwinder. */
export class SjljRuntime {
  readonly #memory: GuestMemory;
  readonly #heap: GuestHeap;
  readonly #unwind: SjljUnwind;
  readonly #types: CxxTypeInfo;
  readonly #matcher: ExceptionMatcher;
  readonly #thread: () => number;
  readonly #exceptions = new Map<number, GuestException>();
  readonly #caught = new Map<number, GuestException[]>();
  // Like libc++abi's emergency exception allocator, retain a small buffer so
  // operator new can still throw bad_alloc after the primary heap is full.
  readonly #reserve: number;
  constructor(
    memory: GuestMemory,
    heap: GuestHeap,
    unwind: SjljUnwind,
    types: CxxTypeInfo,
    matcher: ExceptionMatcher,
  ) {
    this.#memory = memory;
    this.#heap = heap;
    this.#unwind = unwind;
    this.#types = types;
    this.#matcher = matcher;
    this.#thread = unwind.threads.funcs._pthread_self;
    this.#reserve = heap.zero(RESERVE_BYTES);
  }
  #read(address: number): number {
    return read32(this.#memory, address);
  }
  #write(address: number, value: number): void {
    write32(this.#memory, address, value);
  }
  exceptionFor(header: number): GuestException {
    const e = this.#exceptions.get(header);
    if (!e) throw new Error("Unknown guest C++ exception");
    return e;
  }
  #free(header: number): void {
    if (!this.#exceptions.delete(header)) return;
    if (header !== this.#reserve) this.#heap.free(header);
  }
  allocate(bytes: number): number {
    const size = EXCEPTION_HEADER + Math.max(1, bytes);
    let header = this.#heap.zero(size);
    const reserve = this.#reserve;
    if (!header && size <= RESERVE_BYTES && reserve && !this.#exceptions.has(reserve)) {
      header = reserve;
      this.#memory.write(header, new Uint8Array(size));
    }
    if (!header) throw new Error("Guest heap exhausted allocating C++ exception");
    const object = header + EXCEPTION_HEADER;
    this.#exceptions.set(header, {
      object,
      header,
      handlers: 0,
      type: 0,
      destroy: 0,
      pads: [],
      adjusted: undefined,
    });
    return object;
  }
  free(object: number): void {
    this.#free(object - EXCEPTION_HEADER);
  }
  throw(object: number, type: number, destroy: number): GuestLandingPad {
    const e = this.exceptionFor(object - EXCEPTION_HEADER);
    e.type = type;
    e.destroy = destroy;
    return this.#initialize(e);
  }
  #initialize(exception: GuestException): GuestLandingPad {
    exception.pads = [];
    const seen = new Set<number>();
    for (let frame = this.#unwind.threads.unwindTop; frame; frame = this.#read(frame)) {
      if (seen.has(frame)) throw new Error("Cyclic C++ unwind frames");
      seen.add(frame);
      if (!this.#read(frame + Frame.Personality)) continue;
      const result = callSite(this.#memory, this.#matcher, frame, exception);
      if (!result || (!result.cleanup && !result.handler)) continue;
      exception.pads.push({ ...result, frame });
      if (result.handler) return this.resume(exception);
    }
    if (exception.objcObject !== undefined)
      throw new Error(`${UNCAUGHT_OBJC} at 0x${exception.objcObject.toString(HEX)}`);
    throw new Error(`Uncaught guest C++ exception of type ${this.#matcher.nameOf(exception.type)}`);
  }
  resume(exception: GuestException): GuestLandingPad {
    const next = exception.pads.shift();
    if (!next) throw new Error("No handler for guest C++ exception");
    const { frame, pad, selector, value } = next;
    this.#unwind.threads.unwindTop = frame;
    this.#write(frame + Frame.CallSite, pad);
    this.#write(frame + Frame.Exception, exception.header);
    this.#write(frame + Frame.Selector, selector || 0);
    exception.adjusted = value;
    return new GuestLandingPad(
      this.#read(frame + Frame.Resume),
      this.#read(frame + Frame.FramePointer),
      this.#read(frame + Frame.StackPointer),
      this.#thread(),
    );
  }
  beginCatch(header: number): number | undefined {
    const e = this.exceptionFor(header),
      id = this.#thread();
    const stack = this.#caught.get(id) ?? [];
    if (!stack.length || stack.at(-1) !== e) stack.push(e);
    this.#caught.set(id, stack);
    if (e.handlers < 0) e.handlers = -e.handlers;
    e.handlers++;
    return e.adjusted;
  }
  async endCatch(): Promise<void> {
    const stack = this.#caught.get(this.#thread()),
      e = stack?.at(-1);
    if (!stack || !e) throw new Error("Guest ended a C++ catch outside a handler");
    const rethrown = e.handlers < 0;
    e.handlers += rethrown ? 1 : -1;
    if (e.handlers) return;
    stack.pop();
    if (!stack.length) this.#caught.delete(this.#thread());
    if (!rethrown) {
      if (e.destroy) await this.#unwind.nested(e.destroy, [e.object]);
      if (e.objcObject !== undefined) await this.#unwind.objc().releaseObject(e.objcObject);
      this.#free(e.header);
    }
  }
  rethrow(): GuestLandingPad {
    const e = this.#caught.get(this.#thread())?.at(-1);
    if (!e) throw new Error("Guest rethrew outside a C++ catch");
    e.handlers = -e.handlers;
    return this.#initialize(e);
  }
  personality(a: GuestArguments): number {
    if (a(Personality.Version) !== PERSONALITY_VERSION) return Reason.FatalPhase1;
    const flags = a(Personality.Actions),
      e = this.exceptionFor(a(Personality.Exception)),
      frame = a(Personality.Context);
    const result = callSite(this.#memory, this.#matcher, frame, e);
    if (!result) return Reason.ContinueUnwind;
    if (flags & Action.Search) return result.handler ? Reason.HandlerFound : Reason.ContinueUnwind;
    if (
      !(flags & Action.Cleanup) ||
      !(result.cleanup || (result.handler && flags & Action.HandlerFrame))
    )
      return Reason.ContinueUnwind;
    this.#write(frame + Frame.CallSite, result.pad);
    this.#write(frame + Frame.Exception, e.header);
    this.#write(frame + Frame.Selector, result.selector || 0);
    return Reason.InstallContext;
  }
  raiseStandard(name: string, message = 0): GuestLandingPad {
    const standard = this.#types.standard.get(name);
    if (!standard) throw new Error(`Unknown standard C++ exception ${name}`);
    const object = this.allocate(STANDARD_OBJECT_BYTES);
    this.#write(object, standard.vptr);
    this.#write(object + WORD_BYTES, message || standard.text);
    return this.throw(object, standard.type, 0);
  }
  async throwObjC(object: number, uncaught: () => Promise<void>): Promise<GuestLandingPad> {
    const payload = this.allocate(WORD_BYTES);
    this.#write(payload, object);
    const e = this.exceptionFor(payload - EXCEPTION_HEADER);
    e.objcObject = this.#unwind.objc().retainObject(object);
    e.type = this.#types.objcId;
    try {
      return this.#initialize(e);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(UNCAUGHT_OBJC)) await uncaught();
      throw error;
    }
  }
}
