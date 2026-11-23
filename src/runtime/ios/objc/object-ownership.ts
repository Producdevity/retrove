import type { ClassRegistry } from "./class-registry";
import { MINIMUM_INSTANCE_SIZE } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import { MISSING_DESTINATION, withoutArguments } from "./guest-access";
import type { HostResult } from "./host";
import type { CoreGraphics } from "../../graphics/core-graphics/coregraphics";
import type { ObjcGuest, ObjcMethod } from "./runtime-types";
import { returnsStructure } from "./runtime-types";

const POOL_TOKEN_BYTES = 4;
const DEALLOC = "dealloc";
const Register = { Self: 0, Selector: 1 } as const;
export const MAIN_THREAD = 1;
/** A host-allocated object: its retain count and the guest buffers it frees with itself. */
export interface OwnedObject {
  count: number;
  buffers: number[];
  /** The autorelease pool an NSAutoreleasePool instance pushed. */
  token?: number;
}
interface AutoreleasePool {
  readonly token: number;
  readonly objects: number[];
}
export interface ObjectOwnership {
  readonly owned: Map<number, OwnedObject>;
  coreGraphics: CoreGraphics | undefined;
  /** The guest thread making the current call. */
  readonly threadId: () => number;
  readonly alloc: (classPointer: number, extraBytes?: number) => number;
  readonly retain: (self: number) => number;
  readonly destroy: (self: number) => void;
  readonly release: (self: number) => HostResult | Promise<HostResult>;
  readonly releaseFromHost: (self: number) => Promise<void>;
  readonly autorelease: (self: number) => number;
  readonly poolPush: (token?: number) => number;
  /** A kept token stays allocated for the caller's next push; nested pools above it are still freed. */
  readonly poolPop: (token: number, keep?: boolean) => Promise<void>;
}
/** Calls a host implementation the runtime invokes with the receiver only, such as dealloc. */
export function callWithReceiver(
  implementation: ObjcMethod,
  self: number,
): HostResult | Promise<HostResult> {
  if (returnsStructure(implementation))
    return implementation(self, withoutArguments, MISSING_DESTINATION);
  return implementation(self, withoutArguments);
}
export function objectOwnership(
  guest: ObjcGuest,
  memory: GuestAccess,
  registry: ClassRegistry,
): ObjectOwnership {
  const { cpu, heap, callGuest, threads } = guest;
  const owned = new Map<number, OwnedObject>();
  const threadId = () => threads?.funcs._pthread_self() ?? MAIN_THREAD;
  const pools = autoreleasePools(memory, heap, threadId, owned, (self) =>
    ownership.releaseFromHost(self),
  );
  const ownership: ObjectOwnership = {
    owned,
    coreGraphics: undefined,
    threadId,
    alloc(classPointer, extraBytes = 0) {
      const info = registry.classes.get(classPointer);
      if (!info || info.isMeta || !info.supported || info.size < MINIMUM_INSTANCE_SIZE)
        throw new Error("Unsupported class allocation");
      const self = memory.zero(info.size + extraBytes);
      memory.write(self, classPointer);
      owned.set(self, { count: 1, buffers: [] });
      return self;
    },
    retain(self) {
      const quartz = ownership.coreGraphics;
      if (quartz?.owns?.(self)) return quartz.retain(self);
      const object = owned.get(self);
      if (object) object.count++;
      return self;
    },
    destroy(self) {
      const object = owned.get(self);
      if (!object) return;
      for (const pointer of object.buffers) heap.free(pointer);
      owned.delete(self);
      heap.free(self);
    },
    release(self) {
      const quartz = ownership.coreGraphics;
      if (quartz?.owns?.(self)) return quartz.release(self);
      const object = owned.get(self);
      if (!object || --object.count > 0) return;
      const dealloc = registry.lookup(memory.read(self), DEALLOC);
      if (typeof dealloc === "number") {
        cpu.setReg(Register.Self, self);
        cpu.setReg(Register.Selector, registry.selector(DEALLOC));
        return { jump: dealloc };
      }
      if (!dealloc) throw new TypeError("dealloc is not a function");
      return callWithReceiver(dealloc, self);
    },
    async releaseFromHost(self) {
      const object = owned.get(self);
      if (object?.count === 1) {
        const implementation = registry.lookup(memory.read(self), DEALLOC);
        if (typeof implementation === "number") {
          object.count = 0;
          await callGuest(implementation, [self, registry.selector(DEALLOC)]);
          return;
        }
      }
      await ownership.release(self);
    },
    ...pools,
  };
  return ownership;
}
type AutoreleasePools = Pick<ObjectOwnership, "autorelease" | "poolPush" | "poolPop">;
/** Per-thread autorelease pool stacks; a pool's token is the guest word objc returns for it. */
function autoreleasePools(
  memory: GuestAccess,
  heap: ObjcGuest["heap"],
  threadId: () => number,
  owned: ReadonlyMap<number, OwnedObject>,
  releaseFromHost: (self: number) => Promise<void>,
): AutoreleasePools {
  const poolStacks = new Map<number, AutoreleasePool[]>();
  function poolStack(): AutoreleasePool[] {
    const id = threadId();
    let pools = poolStacks.get(id);
    if (!pools) poolStacks.set(id, (pools = []));
    return pools;
  }
  return {
    autorelease: (self) => {
      if (owned.has(self)) poolStack().at(-1)?.objects.push(self);
      return self;
    },
    poolPush: (token = memory.zero(POOL_TOKEN_BYTES)) => {
      poolStack().push({ token, objects: [] });
      return token;
    },
    poolPop: async (token, keep = false) => {
      const pools = poolStack();
      const index = pools.findIndex((pool) => pool.token === token);
      if (index < 0) throw new Error("Invalid Objective-C autorelease pool");
      while (pools.length > index) {
        const pool = pools.pop();
        if (!pool) break;
        for (const self of pool.objects.reverse()) await releaseFromHost(self);
        if (!keep || pool.token !== token) heap.free(pool.token);
      }
    },
  };
}
