import type { GuestArguments } from "../ios/objc/host";
import { read32, readString, write32, type GuestMemory } from "../memory/guest-memory";
import type { CxxTypeInfo } from "./type-info";

const TYPE_NAME = 4;
/** Clang sets the top bit of a type_info name for types without a unique name. */
const NAME_MASK = 0x7fff_ffff;
/** __si_class_type_info: one base at offset 0. */
const SI_BASE = 8;
/** __vmi_class_type_info: base count, then base type_info and offset/flags word pairs. */
const Vmi = { Count: 12, Bases: 16, Flags: 20, Entry: 8 } as const;
const BaseFlag = { Virtual: 1, Public: 2 } as const;
const BASE_OFFSET_SHIFT = 8;
const MAX_DEPTH = 64;
const MAX_BASES = 256;
const CanCatch = { CatchType: 0, ThrownType: 1, Object: 2 } as const;

export interface ExceptionObjc {
  isKindOf(object: number, className: string): boolean;
  retainObject(object: number): number;
  releaseObject(object: number): Promise<void>;
}
/** A thrown value: a C++ object of `type`, or a retained Objective-C object. */
export interface ThrownValue {
  readonly type: number;
  readonly object: number;
  readonly objcObject?: number;
}

/** Decides whether a catch clause's type matches a thrown value, and the pointer it receives. */
export class ExceptionMatcher {
  readonly #memory: GuestMemory;
  readonly #types: CxxTypeInfo;
  readonly #objc: () => ExceptionObjc;
  constructor(memory: GuestMemory, types: CxxTypeInfo, objc: () => ExceptionObjc) {
    this.#memory = memory;
    this.#types = types;
    this.#objc = objc;
  }
  #read(address: number): number {
    return read32(this.#memory, address);
  }
  nameOf(type: number): string {
    return (
      this.#types.typeNames.get(type) ??
      readString(this.#memory, this.#read(type + TYPE_NAME) & NAME_MASK)
    );
  }
  /** type_info::can_catch: adjusts the object pointer in place when the type matches. */
  canCatch(a: GuestArguments): number {
    const thrown = { type: a(CanCatch.ThrownType), object: this.#read(a(CanCatch.Object)) };
    const value = this.adjusted(thrown, a(CanCatch.CatchType));
    if (value === undefined) return 0;
    write32(this.#memory, a(CanCatch.Object), value);
    return 1;
  }
  adjusted(exception: ThrownValue, type: number): number | undefined {
    const types = this.#types;
    if (exception.objcObject !== undefined) {
      if (!type) return exception.objcObject;
      if (this.#read(type) !== types.objcVptr) return undefined;
      const matches =
        type === types.objcId || this.#objc().isKindOf(exception.objcObject, this.nameOf(type));
      return matches ? exception.objcObject : undefined;
    }
    if (type && this.#read(type) === types.objcVptr) return undefined;
    const thrown = this.nameOf(exception.type);
    const pointer = thrown.startsWith("P");
    const value = pointer ? this.#read(exception.object) : exception.object;
    if (!type) return value;
    const target = this.nameOf(type);
    if (exception.type === type || target === thrown) return value;
    if (
      pointer &&
      (target === `PK${thrown.slice(1)}` ||
        (target === "Pv" && !thrown.startsWith("PK")) ||
        target === "PKv")
    )
      return value;
    // Single public, non-virtual inheritance is encoded with the base
    // type_info pointer at offset 8. Pointee qualifiers aren't class bases.
    return pointer ? undefined : this.#upcast(exception.type, type, target, value, 0);
  }
  #bases(from: number): [number, number][] {
    const kind = this.#read(from),
      bases: [number, number][] = [];
    if (kind === this.#types.vtable("si_class")) bases.push([this.#read(from + SI_BASE), 0]);
    else if (kind === this.#types.vtable("vmi_class")) {
      for (let i = 0, count = this.#read(from + Vmi.Count); i < count && i < MAX_BASES; i++) {
        const flags = this.#read(from + Vmi.Flags + Vmi.Entry * i);
        if (flags & BaseFlag.Public && !(flags & BaseFlag.Virtual))
          bases.push([this.#read(from + Vmi.Bases + Vmi.Entry * i), flags >> BASE_OFFSET_SHIFT]);
      }
    }
    return bases;
  }
  // si_class has one base at offset 0; vmi_class lists bases with offset and flags words.
  #upcast(
    from: number,
    type: number,
    target: string,
    value: number,
    depth: number,
  ): number | undefined {
    if (depth > MAX_DEPTH) return undefined;
    for (const [base, offset] of this.#bases(from)) {
      if (!base) continue;
      const moved = (value + offset) >>> 0;
      if (type === base || target === this.nameOf(base)) return moved;
      const found = this.#upcast(base, type, target, moved, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}
