import { installObjectAllocation } from "./allocation";
import type { ClassRegistry } from "./class-registry";
import { ClassField } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import type { HostResult } from "./host";
import { installImplementationLookup } from "./implementations";
import type { Messenger } from "./messaging";
import type { ObjectOwnership } from "./object-ownership";
import { installRootProxy } from "./root-proxy";
import type { HostGate, MethodValue, ObjcGuest } from "./runtime-types";
import { pointerResult } from "./runtime-types";

const ROOT = "NSObject";
const UNOWNED_RETAIN_COUNT = 0xffffffff;
const HASH_ALIGNMENT_BITS = 2;
const CXX_CONSTRUCT = ".cxx_construct";
const CXX_DESTRUCT = ".cxx_destruct";
const STRING_INSTANCE_BYTES = 16;
const BLOCK_KINDS = ["Stack", "Global", "Malloc"] as const;
/** An objc_setAssociatedObject value; a nonzero policy means the owner holds a reference. */
export interface Association {
  readonly value: number;
  readonly policy: number;
}
export interface RootObject {
  /** Associated objects per owner, keyed by the association key pointer. */
  readonly associations: Map<number, Map<number, Association>>;
  readonly allocateObject: (cls: number, extraBytes?: number) => Promise<number>;
  readonly dispose: (self: number) => void | Promise<void>;
  /** The block runtime's isa symbols mapped to their host classes. */
  readonly blockClasses: Map<string, number>;
  readonly implementationAddress: (value: MethodValue, name: string) => number;
}
interface RootHost {
  readonly guest: ObjcGuest;
  readonly memory: GuestAccess;
  readonly registry: ClassRegistry;
  readonly ownership: ObjectOwnership;
  readonly messenger: Messenger;
  readonly hostGate: HostGate | undefined;
}
/** NSObject, NSProxy and NSAutoreleasePool, the classes every host bridge builds on. */
export function installRootObject(host: RootHost): RootObject {
  const { guest, memory, registry, ownership, messenger } = host;
  const { read } = memory;
  const { method, selector } = registry;
  const associations = new Map<number, Map<number, Association>>();
  const blockClasses = registerBaseClasses(registry);
  async function allocateObject(cls: number, extraBytes = 0): Promise<number> {
    const pointer = ownership.alloc(cls, extraBytes);
    const lineage: number[] = [];
    for (let current = cls; current; current = read(current + ClassField.Superclass))
      lineage.push(current);
    for (const current of lineage.reverse()) {
      const implementation = registry.record(current).methods.get(CXX_CONSTRUCT);
      if (
        typeof implementation === "number" &&
        !(await guest.callGuest(implementation, [pointer, selector(CXX_CONSTRUCT)]))
      ) {
        ownership.destroy(pointer);
        return 0;
      }
    }
    return pointer;
  }
  function dispose(self: number): void | Promise<void> {
    const linked = associations.get(self);
    associations.delete(self);
    const destructors: number[] = [];
    for (let current = read(self); current; current = read(current + ClassField.Superclass)) {
      const implementation = registry.record(current).methods.get(CXX_DESTRUCT);
      if (typeof implementation === "number") destructors.push(implementation);
    }
    if (!linked?.size && !destructors.length) return ownership.destroy(self);
    return (async () => {
      for (const object of linked?.values() ?? [])
        if (object.policy) await ownership.releaseFromHost(object.value);
      for (const implementation of destructors)
        await guest.callGuest(implementation, [self, selector(CXX_DESTRUCT)]);
      ownership.destroy(self);
    })();
  }
  installObjectAllocation({
    method,
    allocate: allocateObject,
    send: async (receiver, selector, args) =>
      pointerResult(await messenger.send(receiver, selector, args)),
  });
  installObjectMethods(host);
  method(ROOT, false, "dealloc", (self) => dispose(self));
  method(ROOT, false, "hash", (self) => self >>> HASH_ALIGNMENT_BITS);
  const implementations = installImplementationLookup({
    method,
    isa: read,
    selector: memory.cString,
    lookup: registry.lookup,
    gate: (name, implementation) => {
      if (!host.hostGate) throw new Error("Host IMP gates are unavailable");
      return host.hostGate({ name: `IMP ${name}`, library: "Foundation" }, implementation);
    },
  });
  installRootProxy({
    hostClass: registry.hostClass,
    copyMethod: (target, source, meta, name) => {
      const sourceClass = registry.names.get(source),
        targetClass = registry.names.get(target);
      const owner = (pointer: number | undefined) =>
        registry.record(meta ? read(pointer ?? 0) : (pointer ?? 0));
      const implementation = owner(sourceClass).methods.get(name);
      if (!implementation) throw new Error(`Missing root proxy method ${name}`);
      owner(targetClass).methods.set(name, implementation);
    },
  });
  installAutoreleasePool(registry, ownership);
  return {
    associations,
    blockClasses,
    allocateObject,
    dispose,
    implementationAddress: (value, name) => implementations.address(value, name),
  };
}
function registerBaseClasses({ hostClass }: ClassRegistry): Map<string, number> {
  hostClass(ROOT, null);
  hostClass("NSString", ROOT, STRING_INSTANCE_BYTES);
  hostClass("NSConstantString", "NSString", STRING_INSTANCE_BYTES);
  hostClass("NSMutableString", "NSString", STRING_INSTANCE_BYTES);
  hostClass("NSBundle", ROOT);
  hostClass("NSAutoreleasePool", ROOT);
  hostClass("EAGLContext", ROOT);
  hostClass("EAGLSharegroup", ROOT);
  hostClass("NSBlock", ROOT);
  return new Map(
    BLOCK_KINDS.map((kind) => [`__NSConcrete${kind}Block`, hostClass(`NS${kind}Block`, "NSBlock")]),
  );
}
function installObjectMethods({ memory, registry, ownership }: RootHost): void {
  const { read } = memory;
  const { method, lookup, subclass } = registry;
  method(ROOT, true, "class", (self) => self);
  method(ROOT, false, "class", (self) => read(self));
  for (const meta of [false, true]) {
    method(ROOT, meta, "self", (self) => self);
    method(ROOT, meta, "superclass", (self) =>
      read((meta ? self : read(self)) + ClassField.Superclass),
    );
    method(ROOT, meta, "respondsToSelector:", (self, args) =>
      Number(!!lookup(read(self), memory.cString(args(0)))),
    );
    method(ROOT, meta, "isKindOfClass:", (self, args) => Number(subclass(read(self), args(0))));
    method(ROOT, meta, "isMemberOfClass:", (self, args) => Number(read(self) === args(0)));
    method(ROOT, meta, "isEqual:", (self, args) => Number(self === args(0)));
    method(ROOT, meta, "retain", ownership.retain);
    method(ROOT, meta, "release", ownership.release);
    method(ROOT, meta, "autorelease", ownership.autorelease);
    method(
      ROOT,
      meta,
      "retainCount",
      (self) => ownership.owned.get(self)?.count ?? UNOWNED_RETAIN_COUNT,
    );
  }
  method(ROOT, true, "isSubclassOfClass:", (self, args) => Number(subclass(self, args(0))));
  method(ROOT, false, "init", (self) => self);
  method(ROOT, false, "awakeFromNib", () => {});
}
function installAutoreleasePool(registry: ClassRegistry, ownership: ObjectOwnership): void {
  const owned = (self: number) => {
    const object = ownership.owned.get(self);
    if (!object) throw new TypeError("Cannot use an autorelease pool the host does not own");
    return object;
  };
  registry.method("NSAutoreleasePool", false, "init", (self) => {
    owned(self).token = ownership.poolPush();
    return self;
  });
  const drain = async (self: number): Promise<HostResult> => {
    const object = owned(self);
    if (object.token) await ownership.poolPop(object.token);
    ownership.destroy(self);
  };
  registry.method("NSAutoreleasePool", false, "dealloc", drain);
  registry.method("NSAutoreleasePool", false, "drain", drain);
}
