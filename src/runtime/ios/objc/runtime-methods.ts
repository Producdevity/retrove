import type { GuestArguments } from "./host";
import type { MethodValue } from "./implementations";

/** objc_class, class_ro_t, ivar_list_t and ivar_t field offsets on 32-bit ARM. */
const Class = { Isa: 0, Superclass: 4, Data: 16 } as const;
const ReadOnly = { Ivars: 28 } as const;
const IvarList = { Count: 4, First: 8, Entry: 20 } as const;
const Ivar = { Offset: 0, Name: 4, Type: 8 } as const;
/** method_t is name, types and imp. */
const METHOD_BYTES = 12;
const DATA_FLAGS = 3;
const WORD = 4;
const GENERIC_TYPES = "v@:";
/** Argument positions shared by the class_* and object_* calls. */
const Arg = { Target: 0, Name: 1, Value: 2, Count: 1, Second: 1 } as const;

export interface RuntimeMethodsHost {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
  allocate(bytes: number): number;
  cString(pointer: number): string;
  permanentString(value: string): number;
  selector(name: string): number;
  /** The methods a class defines itself; undefined for unknown or unsupported classes. */
  methods(classPointer: number): Map<string, MethodValue> | undefined;
  /** Every non-meta class the runtime knows. */
  classList(): readonly number[];
  address(value: MethodValue, name: string): number;
  typeEncoding(value: MethodValue): string | undefined;
}
interface MethodHandle {
  owner: number;
  name: string;
}
type Imports = Record<string, (args: GuestArguments) => number | void>;

function superclasses(host: RuntimeMethodsHost, start: number): number[] {
  const chain: number[] = [];
  for (
    let klass = start;
    klass && !chain.includes(klass);
    klass = host.read(klass + Class.Superclass)
  )
    chain.push(klass);
  return chain;
}
/** A zero-terminated guest array of the items, with the count written to `count` when given. */
function guestArray(host: RuntimeMethodsHost, items: readonly number[], count: number): number {
  if (count) host.write(count, items.length);
  if (!items.length) return 0;
  const pointer = host.allocate((items.length + 1) * WORD);
  items.forEach((item, index) => host.write(pointer + index * WORD, item));
  host.write(pointer + items.length * WORD, 0);
  return pointer;
}

/** Method, Ivar and class-list reflection, including the swizzling calls SDKs rely on. */
export function runtimeMethodImports(host: RuntimeMethodsHost): Imports {
  const handles = new MethodHandles(host);
  return { ...methodImports(host, handles), ...classImports(host, handles), ...ivarImports(host) };
}

class MethodHandles {
  readonly #handles = new Map<number, MethodHandle>();
  readonly #byKey = new Map<string, number>();
  constructor(private readonly host: RuntimeMethodsHost) {}
  handle(owner: number, name: string): number {
    const key = `${owner}:${name}`;
    let pointer = this.#byKey.get(key);
    if (!pointer) {
      pointer = this.host.allocate(METHOD_BYTES);
      this.host.write(pointer, this.host.selector(name));
      this.host.write(pointer + WORD, this.host.permanentString(GENERIC_TYPES));
      this.#byKey.set(key, pointer);
      this.#handles.set(pointer, { owner, name });
    }
    return pointer;
  }
  find(start: number, name: string): number {
    const owner = superclasses(this.host, start).find((klass) =>
      this.host.methods(klass)?.has(name),
    );
    return owner ? this.handle(owner, name) : 0;
  }
  entry(pointer: number): MethodHandle | undefined {
    return this.#handles.get(pointer);
  }
  value(pointer: number): MethodValue | undefined {
    const entry = this.#handles.get(pointer);
    return entry ? this.host.methods(entry.owner)?.get(entry.name) : undefined;
  }
  imp(pointer: number): number {
    const entry = this.#handles.get(pointer),
      method = this.value(pointer);
    return entry && method !== undefined ? this.host.address(method, entry.name) : 0;
  }
  setImp(pointer: number, imp: number): number {
    const entry = this.#handles.get(pointer),
      old = this.imp(pointer);
    if (entry && imp) this.host.methods(entry.owner)?.set(entry.name, imp);
    return old;
  }
}

function methodImports(host: RuntimeMethodsHost, handles: MethodHandles): Imports {
  return {
    _method_getName: (a) => {
      const entry = handles.entry(a(Arg.Target));
      return entry ? host.selector(entry.name) : 0;
    },
    _method_getImplementation: (a) => handles.imp(a(Arg.Target)),
    _method_getTypeEncoding: (a) => {
      if (!handles.entry(a(Arg.Target))) return 0;
      const method = handles.value(a(Arg.Target));
      return host.permanentString(
        (method === undefined ? undefined : host.typeEncoding(method)) ?? GENERIC_TYPES,
      );
    },
    _method_setImplementation: (a) => handles.setImp(a(Arg.Target), a(Arg.Second)),
    _method_exchangeImplementations: (a) => {
      const first = handles.imp(a(Arg.Target)),
        second = handles.imp(a(Arg.Second));
      if (!first || !second) return;
      handles.setImp(a(Arg.Target), second);
      handles.setImp(a(Arg.Second), first);
    },
  };
}

function classImports(host: RuntimeMethodsHost, handles: MethodHandles): Imports {
  const lookup = (a: GuestArguments, meta = false) => {
    if (!a(Arg.Target) || !a(Arg.Name)) return 0;
    const start = meta ? host.read(a(Arg.Target) + Class.Isa) : a(Arg.Target);
    return handles.find(start, host.cString(a(Arg.Name)));
  };
  return {
    _class_getInstanceMethod: (a) => lookup(a),
    _class_getClassMethod: (a) => lookup(a, true),
    _class_respondsToSelector: (a) => Number(Boolean(lookup(a))),
    _class_getMethodImplementation: (a) => {
      const method = lookup(a);
      return method ? handles.imp(method) : 0;
    },
    _class_addMethod: (a) => {
      const methods = host.methods(a(Arg.Target)),
        name = host.cString(a(Arg.Name));
      if (!methods || methods.has(name)) return 0;
      methods.set(name, a(Arg.Value));
      return 1;
    },
    _class_replaceMethod: (a) => {
      const methods = host.methods(a(Arg.Target)),
        name = host.cString(a(Arg.Name));
      if (!methods) return 0;
      const old = methods.get(name);
      methods.set(name, a(Arg.Value));
      return old === undefined ? 0 : host.address(old, name);
    },
    _class_copyMethodList: (a) => {
      const methods = host.methods(a(Arg.Target));
      const items = methods
        ? [...methods.keys()].map((name) => handles.handle(a(Arg.Target), name))
        : [];
      return guestArray(host, items, a(Arg.Count));
    },
    _objc_getClassList: (a) => {
      const list = host.classList();
      if (a(Arg.Target))
        list
          .slice(0, a(Arg.Count))
          .forEach((klass, index) => host.write(a(Arg.Target) + index * WORD, klass));
      return list.length;
    },
    _objc_copyClassList: (a) => guestArray(host, host.classList(), a(Arg.Target)),
  };
}

function ivarImports(host: RuntimeMethodsHost): Imports {
  const ivars = (klass: number): number[] => {
    const readOnly = host.read(klass + Class.Data) & ~DATA_FLAGS;
    const list = readOnly ? host.read(readOnly + ReadOnly.Ivars) : 0;
    if (!list) return [];
    return Array.from(
      { length: host.read(list + IvarList.Count) },
      (_, index) => list + IvarList.First + index * IvarList.Entry,
    );
  };
  const find = (start: number, name: string): number => {
    for (const klass of superclasses(host, start)) {
      const match = ivars(klass).find((ivar) => host.cString(host.read(ivar + Ivar.Name)) === name);
      if (match) return match;
    }
    return 0;
  };
  const offset = (ivar: number) => {
    const pointer = ivar ? host.read(ivar + Ivar.Offset) : 0;
    return pointer ? host.read(pointer) : 0;
  };
  const ofObject = (a: GuestArguments) =>
    a(Arg.Target) && a(Arg.Name) ? find(host.read(a(Arg.Target)), host.cString(a(Arg.Name))) : 0;
  return {
    _class_getInstanceVariable: (a) =>
      a(Arg.Target) && a(Arg.Name) ? find(a(Arg.Target), host.cString(a(Arg.Name))) : 0,
    _class_copyIvarList: (a) =>
      guestArray(host, a(Arg.Target) ? ivars(a(Arg.Target)) : [], a(Arg.Count)),
    _ivar_getName: (a) => (a(Arg.Target) ? host.read(a(Arg.Target) + Ivar.Name) : 0),
    _ivar_getTypeEncoding: (a) => (a(Arg.Target) ? host.read(a(Arg.Target) + Ivar.Type) : 0),
    _ivar_getOffset: (a) => offset(a(Arg.Target)),
    _object_getInstanceVariable: (a) => {
      const ivar = ofObject(a);
      if (ivar && a(Arg.Value)) host.write(a(Arg.Value), host.read(a(Arg.Target) + offset(ivar)));
      return ivar;
    },
    _object_setInstanceVariable: (a) => {
      const ivar = ofObject(a);
      if (ivar) host.write(a(Arg.Target) + offset(ivar), a(Arg.Value));
      return ivar;
    },
  };
}
