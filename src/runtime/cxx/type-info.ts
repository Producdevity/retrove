import type { GuestHeap } from "../ios/libc/guest-imports";
import type { GuestArguments, HostResult } from "../ios/objc/host";
import { read32, write32, type GuestMemory } from "../memory/guest-memory";

const WORD_BYTES = 4;
/** A vtable starts with offset-to-top and the type_info pointer; the object's vptr follows them. */
const VTABLE_HEADER = 8;
/** std::type_info: vptr and name; __si_class_type_info adds its base; __pointer_type_info flags and pointee. */
const TypeInfo = { Vptr: 0, Name: 4, Base: 8, Flags: 8, Pointee: 12 } as const;
const TYPE_INFO_BYTES = 8;
const SI_TYPE_INFO_BYTES = 12;
const POINTER_TYPE_INFO_BYTES = 16;
const METATYPE_BYTES = 12;
/** Retrove's Objective-C exception type: vptr, class name and class pointer. */
const OBJC_TYPE_BYTES = 12;
const OBJC_CLASS = 8;
/** std::exception subclasses keep their message pointer after the vptr. */
const EXCEPTION_MESSAGE = 4;
const KINDS = ["class", "si_class", "vmi_class", "fundamental", "pbase", "pointer"] as const;
export type TypeKind = (typeof KINDS)[number];
const METATYPE_BASES: Partial<Record<TypeKind, TypeKind>> = {
  si_class: "class",
  vmi_class: "class",
  pointer: "pbase",
};
const CLASS_QUERIES = [
  "search_above_dst",
  "search_below_dst",
  "has_unambiguous_public_base",
] as const;
const POINTER_QUALIFIERS = [
  ["Pw", 0],
  ["PKw", 1],
] as const;
/** libc++ exception classes: mangled name, base class and default what() text. */
const STANDARD_EXCEPTIONS = [
  ["St9exception", "", "std::exception"],
  ["St9bad_alloc", "St9exception", "std::bad_alloc"],
  ["St11logic_error", "St9exception", ""],
  ["St12length_error", "St11logic_error", "vector"],
  ["St12out_of_range", "St11logic_error", "vector"],
  ["St16invalid_argument", "St11logic_error", ""],
  ["St12domain_error", "St11logic_error", ""],
  ["St13runtime_error", "St9exception", ""],
  ["St11range_error", "St13runtime_error", ""],
  ["St14overflow_error", "St13runtime_error", ""],
  ["St15underflow_error", "St13runtime_error", ""],
] as const;

export type TypeInfoGate = (
  name: string,
  implementation: (args: GuestArguments) => HostResult,
) => number;
/** Host implementations shared by every type_info vtable. */
export interface TypeInfoMethods {
  readonly nop: number;
  readonly deleting: number;
  readonly canCatch: number;
}
export interface StandardException {
  readonly type: number;
  readonly vptr: number;
  readonly text: number;
}

/** The libc++abi type_info classes, builtin types and standard exceptions a guest can catch. */
export class CxxTypeInfo {
  readonly data = new Map<string, number>();
  readonly typeNames = new Map<number, string>();
  readonly standard = new Map<string, StandardException>();
  readonly objcVptr: number;
  readonly objcId: number;
  readonly #vtables = new Map<TypeKind, number>();
  readonly #objcTypes = new Map<string, number>();
  readonly #memory: GuestMemory;
  readonly #heap: GuestHeap;
  constructor(memory: GuestMemory, heap: GuestHeap, gate: TypeInfoGate, methods: TypeInfoMethods) {
    this.#memory = memory;
    this.#heap = heap;
    this.#metatypes(gate, methods);
    const wchar = this.#builtin("w", "fundamental");
    for (const [name, flags] of POINTER_QUALIFIERS) {
      const pointer = this.#builtin(name, "pointer", POINTER_TYPE_INFO_BYTES);
      this.#write(pointer + TypeInfo.Flags, flags);
      this.#write(pointer + TypeInfo.Pointee, wchar);
    }
    const { nop, canCatch } = methods;
    this.objcVptr = this.#table("_objc_ehtype_vtable", [nop, nop, nop, nop, canCatch]);
    this.objcId = this.objcType("id");
    this.data.set("_OBJC_EHTYPE_id", this.objcId);
    this.#write(this.objcVptr - WORD_BYTES, this.objcId);
    this.#standardExceptions(gate, methods);
  }
  #write(address: number, value: number): void {
    write32(this.#memory, address, value);
  }
  vtable(kind: TypeKind): number {
    const vtable = this.#vtables.get(kind);
    if (vtable === undefined) throw new Error(`Missing C++ ${kind} type_info vtable`);
    return vtable;
  }
  symbol(name: string): number {
    const address = this.data.get(name);
    if (address === undefined) throw new Error(`Missing C++ symbol ${name}`);
    return address;
  }
  #table(symbol: string, methods: readonly number[]): number {
    const address = this.#heap.zero(VTABLE_HEADER + WORD_BYTES * methods.length);
    if (!address) throw new Error("Unable to allocate C++ virtual table");
    methods.forEach((pc, i) => this.#write(address + VTABLE_HEADER + WORD_BYTES * i, pc));
    this.data.set(symbol, address);
    return address + VTABLE_HEADER;
  }
  #metatypes(gate: TypeInfoGate, { nop, deleting, canCatch }: TypeInfoMethods): void {
    const metatypes = new Map<TypeKind, number>();
    for (const kind of KINDS) {
      const cls = `__${kind}_type_info`,
        mangled = `N10__cxxabiv1${cls.length}${cls}E`;
      const methods = [nop, deleting, nop, nop, canCatch];
      if (kind.endsWith("class")) {
        for (const query of CLASS_QUERIES) {
          methods.push(
            gate(`${cls}::${query}`, () => {
              throw new Error(`Unsupported standalone C++ RTTI query ${query}`);
            }),
          );
        }
      }
      const vtable = this.#table(`__ZTV${mangled}`, methods);
      this.#vtables.set(kind, vtable);
      const info = this.#heap.zero(METATYPE_BYTES);
      this.#write(info + TypeInfo.Name, this.#heap.string(mangled));
      metatypes.set(kind, info);
      this.#write(vtable - WORD_BYTES, info);
      this.data.set(`__ZTI${mangled}`, info);
    }
    for (const [kind, info] of metatypes) {
      const base = METATYPE_BASES[kind];
      this.#write(info, this.vtable(base ? "si_class" : "class"));
      if (base) this.#write(info + TypeInfo.Base, metatypes.get(base) ?? 0);
    }
  }
  #builtin(name: string, kind: TypeKind, bytes = TYPE_INFO_BYTES): number {
    const p = this.#heap.zero(bytes);
    if (!p) throw new Error("Unable to allocate C++ type information");
    this.#write(p + TypeInfo.Vptr, this.vtable(kind));
    this.#write(p + TypeInfo.Name, this.#heap.string(name));
    this.typeNames.set(p, name);
    this.data.set(`__ZTI${name}`, p);
    return p;
  }
  objcType(name: string, cls = 0): number {
    const known = this.#objcTypes.get(name);
    if (known !== undefined) return known;
    const p = this.#heap.zero(OBJC_TYPE_BYTES);
    this.#write(p + TypeInfo.Vptr, this.objcVptr);
    this.#write(p + TypeInfo.Name, this.#heap.string(name));
    this.#write(p + OBJC_CLASS, cls);
    this.#objcTypes.set(name, p);
    this.typeNames.set(p, name);
    return p;
  }
  #standardExceptions(gate: TypeInfoGate, { nop, deleting }: TypeInfoMethods): void {
    for (const [name, base, message] of STANDARD_EXCEPTIONS) {
      const type = this.#builtin(
        name,
        base ? "si_class" : "class",
        base ? SI_TYPE_INFO_BYTES : TYPE_INFO_BYTES,
      );
      if (base) this.#write(type + TypeInfo.Base, this.symbol(`__ZTI${base}`));
      const text = this.#heap.string(message);
      // The message pointer sits where libstdc++ keeps its std::string's characters.
      const what = gate(
        `${name}::what`,
        (a) => read32(this.#memory, a(0) + EXCEPTION_MESSAGE) || text,
      );
      const vptr = this.#table(`__ZTV${name}`, [nop, deleting, what]);
      this.#write(vptr - WORD_BYTES, type);
      this.standard.set(name, { type, vptr, text });
    }
  }
}
