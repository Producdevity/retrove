import type { GuestAccess } from "./guest-access";
import { zoneCopySelector, type HostMethod } from "./host";
import type { ClassRecord, MethodTable, MethodValue, ObjcHeap } from "./runtime-types";

const HEX = 16;
/** objc_class and class_ro_t on 32-bit ARM. */
export const ClassField = { Isa: 0, Superclass: 4, Data: 16 } as const;
const CLASS_BYTES = 20;
const ReadOnlyField = { Flags: 0, InstanceSize: 8, Name: 16, BaseMethods: 20 } as const;
const READ_ONLY_BYTES = 40;
const DATA_FLAG_MASK = 3;
const MAX_INSTANCE_SIZE = 0x4000000;
/** method_list_t is entsize-and-flags and count, then name, types and imp per method. */
const MethodList = {
  Flags: 0,
  Count: 4,
  First: 8,
  EntrySizeMask: 0xffff,
  MaxCount: 65536,
} as const;
const MethodEntry = { Name: 0, Types: 4, Implementation: 8, Size: 12 } as const;
export const MINIMUM_INSTANCE_SIZE = 4;

/** Host implementations get their parameter types from the first signature. */
export interface MethodRegistrar {
  (className: string, meta: boolean, name: string, implementation: HostMethod): void;
  (className: string, meta: boolean, name: string, implementation: MethodValue): void;
}
export interface ClassRegistry {
  readonly classes: Map<number, ClassRecord>;
  readonly names: Map<string, number>;
  readonly referencedSelectors: Set<string>;
  readonly selector: (name: string) => number;
  readonly hostClass: (
    name: string,
    parentName: string | null,
    size?: number,
    supported?: boolean,
  ) => number;
  readonly method: MethodRegistrar;
  /** The class record for a pointer the runtime registered. */
  readonly record: (pointer: number) => ClassRecord;
  readonly lookup: (start: number, name: string) => MethodValue | null;
  readonly subclass: (start: number, ancestor: number) => boolean;
  readonly loadMethods: (list: number, table: MethodTable) => void;
  readonly register: (pointer: number, isMeta: boolean, owner: number) => void;
  readonly typeEncoding: (value: MethodValue | null) => string | undefined;
  readonly coverage: () => { classes: string[]; selectors: string[] };
}
interface ClassTables {
  readonly classes: Map<number, ClassRecord>;
  readonly names: Map<string, number>;
  readonly methodTypes: Map<number, string>;
  readonly referencedSelectors: Set<string>;
}
/** Builds objc_class, its metaclass and both class_ro_t records for a host class. */
function defineHostClass(
  { classes, names }: ClassTables,
  { read, write, zero }: GuestAccess,
  heap: ObjcHeap,
  name: string,
  parentName: string | null,
  size: number,
  supported: boolean,
): number {
  const existing = names.get(name);
  if (existing !== undefined) return existing;
  const parent = parentName === null ? undefined : names.get(parentName);
  const address = zero(CLASS_BYTES),
    meta = zero(CLASS_BYTES),
    cName = heap.string(name);
  for (const [pointer, isMeta] of [
    [address, false],
    [meta, true],
  ] as const) {
    const readOnly = zero(READ_ONLY_BYTES),
      instanceSize = isMeta ? CLASS_BYTES : size;
    write(pointer + ClassField.Data, readOnly);
    write(readOnly + ReadOnlyField.Flags, Number(isMeta));
    write(readOnly + ReadOnlyField.InstanceSize, instanceSize);
    write(readOnly + ReadOnlyField.Name, cName);
    classes.set(pointer, {
      name,
      pointer,
      isMeta,
      owner: address,
      size: instanceSize,
      supported,
      methods: new Map(),
    });
  }
  names.set(name, address);
  write(address + ClassField.Isa, meta);
  write(address + ClassField.Superclass, parent ?? 0);
  write(meta + ClassField.Isa, parent ? read(read(parent)) : meta);
  write(meta + ClassField.Superclass, parent ? read(parent) : address);
  return address;
}
function hierarchyLookup(
  classes: ReadonlyMap<number, ClassRecord>,
  read: GuestAccess["read"],
  start: number,
  name: string,
): MethodValue | null {
  const seen = new Set<number>();
  for (let pointer = start; pointer; pointer = read(pointer + ClassField.Superclass)) {
    const info = classes.get(pointer);
    if (!info || seen.has(pointer))
      throw new Error(`Invalid Objective-C class hierarchy at 0x${pointer.toString(HEX)}`);
    if (!info.supported) throw new Error(`Unimplemented Objective-C class ${info.name} (${name})`);
    seen.add(pointer);
    const value = info.methods.get(name);
    if (value !== undefined) return value;
  }
  return null;
}
function isSubclass(read: GuestAccess["read"], start: number, ancestor: number): boolean {
  const seen = new Set<number>();
  for (
    let pointer = start;
    pointer && !seen.has(pointer);
    pointer = read(pointer + ClassField.Superclass)
  ) {
    if (pointer === ancestor) return true;
    seen.add(pointer);
  }
  return false;
}
/** Registers the image's classes and their method lists, uniquing selectors in place. */
function imageClasses(
  { classes, names, methodTypes }: ClassTables,
  memory: GuestAccess,
  selector: (name: string) => number,
): Pick<ClassRegistry, "loadMethods" | "register"> {
  const { read, write } = memory;
  function loadMethods(list: number, table: MethodTable): void {
    if (!list) return;
    const stride = read(list + MethodList.Flags) & MethodList.EntrySizeMask,
      count = read(list + MethodList.Count);
    if (stride !== MethodEntry.Size || count > MethodList.MaxCount)
      throw new Error("Invalid Objective-C method list");
    for (let index = 0; index < count; index++) {
      const at = list + MethodList.First + index * stride;
      const old = read(at + MethodEntry.Name),
        name = memory.cString(old),
        canonical = selector(name);
      if (old !== canonical) write(at + MethodEntry.Name, canonical);
      table.set(name, read(at + MethodEntry.Implementation));
      if (read(at + MethodEntry.Types))
        methodTypes.set(
          read(at + MethodEntry.Implementation),
          memory.cString(read(at + MethodEntry.Types)),
        );
    }
  }
  function register(pointer: number, isMeta: boolean, owner: number): void {
    if (classes.has(pointer)) return;
    const data = (read(pointer + ClassField.Data) & ~DATA_FLAG_MASK) >>> 0;
    const name = memory.cString(read(data + ReadOnlyField.Name)),
      size = read(data + ReadOnlyField.InstanceSize);
    if (size > MAX_INSTANCE_SIZE) throw new Error(`Invalid Objective-C class size for ${name}`);
    const info: ClassRecord = {
      name,
      pointer,
      isMeta,
      owner,
      size: Math.max(size, MINIMUM_INSTANCE_SIZE),
      supported: true,
      methods: new Map(),
    };
    classes.set(pointer, info);
    loadMethods(read(data + ReadOnlyField.BaseMethods), info.methods);
    if (!isMeta) {
      names.set(name, pointer);
      register(read(pointer + ClassField.Isa), true, pointer);
    }
  }
  return { loadMethods, register };
}
/** Framework classes the app links that Retrove lacks, and selectors nothing defines. */
function classCoverage({ classes, referencedSelectors }: ClassTables): {
  classes: string[];
  selectors: string[];
} {
  const defined = new Set<string>();
  for (const info of classes.values())
    if (info.supported) for (const name of info.methods.keys()) defined.add(name);
  return {
    classes: [...classes.values()]
      .filter((info) => !info.isMeta && !info.supported)
      .map((info) => info.name)
      .sort(),
    selectors: [...referencedSelectors].filter((name) => !defined.has(name)).sort(),
  };
}
export function classRegistry(memory: GuestAccess, heap: ObjcHeap): ClassRegistry {
  const { read } = memory;
  const tables: ClassTables = {
    classes: new Map(),
    names: new Map(),
    methodTypes: new Map(),
    referencedSelectors: new Set(),
  };
  const { classes, names, methodTypes } = tables;
  const selectors = new Map<string, number>();
  const selector = (name: string): number => {
    const existing = selectors.get(name);
    if (existing !== undefined) return existing;
    const created = heap.string(name);
    selectors.set(name, created);
    return created;
  };
  const record = (pointer: number): ClassRecord => {
    const info = classes.get(pointer);
    if (!info) throw new Error(`Unknown Objective-C class at 0x${pointer.toString(HEX)}`);
    return info;
  };
  const classPointer = (name: string): number => {
    const pointer = names.get(name);
    if (pointer === undefined) throw new Error(`Unknown Objective-C class ${name}`);
    return pointer;
  };
  function method(
    className: string,
    meta: boolean,
    name: string,
    implementation: MethodValue,
  ): void {
    const pointer = classPointer(className);
    const methods = record(meta ? read(pointer) : pointer).methods;
    methods.set(name, implementation);
    const zoned = zoneCopySelector(name);
    if (zoned) methods.set(zoned, implementation);
  }
  return {
    classes,
    names,
    referencedSelectors: tables.referencedSelectors,
    selector,
    hostClass: (name, parentName, size = MINIMUM_INSTANCE_SIZE, supported = true) =>
      defineHostClass(tables, memory, heap, name, parentName, size, supported),
    method,
    record,
    lookup: (start, name) => hierarchyLookup(classes, read, start, name),
    subclass: (start, ancestor) => isSubclass(read, start, ancestor),
    ...imageClasses(tables, memory, selector),
    typeEncoding: (value) => (typeof value === "number" ? methodTypes.get(value) : undefined),
    coverage: () => classCoverage(tables),
  };
}
