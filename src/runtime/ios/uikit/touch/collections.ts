import { WORD_BYTES } from "../../abi/scalars";
import { Argument } from "../../objc/host";
import type { TouchBase } from "./context";
import { classPointer } from "./context";

const ENUMERATION_ITEMS_OFFSET = WORD_BYTES;
const ENUMERATION_MUTATIONS_OFFSET = WORD_BYTES + WORD_BYTES;
const ARRAY_CLASS = "NSArray";
const SET_CLASS = "NSSet";
const MUTABLE_ARRAY_CLASS = "NSMutableArray";
const MUTABLE_SET_CLASS = "NSMutableSet";
const OUT_OF_BOUNDS = "NSArray index outside bounds";

export interface Collections {
  items: (pointer: number) => number[];
  collection: (className: string, values: readonly number[]) => number;
  array: (values: readonly number[]) => number;
}

export function createCollections(base: TouchBase): Collections {
  const { names, alloc, retain, autorelease, state } = base;
  const collection = (className: string, values: readonly number[]): number => {
    const object = alloc(classPointer(names, className));
    state.collections.set(object, values.map(retain));
    return object;
  };
  const items = (pointer: number): number[] => {
    let list = state.collections.get(pointer);
    if (!list) {
      list = [];
      state.collections.set(pointer, list);
    }
    return list;
  };
  const array = (values: readonly number[]): number => autorelease(collection(ARRAY_CLASS, values));
  return { items, collection, array };
}

function installFactories(base: TouchBase, collections: Collections): void {
  const { method, alloc, retain, autorelease, send, releaseFromHost } = base;
  const { items, collection } = collections;
  for (const [cls, mutable, factory] of [
    [ARRAY_CLASS, MUTABLE_ARRAY_CLASS, "array"],
    [SET_CLASS, MUTABLE_SET_CLASS, "set"],
  ] as const) {
    method(cls, true, factory, (self) => autorelease(alloc(self)));
    method(cls, true, `${factory}WithObject:`, (self, args) => {
      const pointer = alloc(self);
      items(pointer).push(retain(args(0)));
      return autorelease(pointer);
    });
    method(mutable, true, `${factory}WithCapacity:`, (self) => autorelease(alloc(self)));
    method(cls, false, "containsObject:", async (self, args) => {
      const target = args(0);
      for (const item of items(self)) {
        if (item === target || (await send(item, "isEqual:", [target]))) return 1;
      }
      return 0;
    });
    method(mutable, false, "addObject:", async (self, args) => {
      const value = args(0);
      if (!value) throw new Error(`Adding nil to ${mutable}`);
      if (cls === SET_CLASS && (await send(self, "containsObject:", [value]))) return;
      items(self).push(retain(value));
    });
    method(mutable, false, "removeAllObjects", async (self) => {
      for (const value of items(self).splice(0)) await releaseFromHost(value);
    });
    method(mutable, false, "removeObject:", async (self, args) => {
      const target = args(0);
      const list = items(self);
      for (let index = list.length - 1; index >= 0; index--) {
        const item = list[index];
        if (item === undefined) continue;
        if (item === target || (await send(item, "isEqual:", [target]))) {
          const [value] = list.splice(index, 1);
          if (value !== undefined) await releaseFromHost(value);
        }
      }
    });
    method(cls, false, "copy", (self) => collection(cls, items(self)));
    method(cls, false, "mutableCopy", (self) => collection(mutable, items(self)));
  }
}

function installArrayMethods(base: TouchBase, collections: Collections): void {
  const { method, alloc, retain, autorelease, send, releaseFromHost, read } = base;
  const { items, collection } = collections;
  const { collections: registry } = base.state;
  method(ARRAY_CLASS, true, "arrayWithObjects:", (self, args) => {
    const pointer = alloc(self);
    for (let index = 0; args(index); index++) items(pointer).push(retain(args(index)));
    return autorelease(pointer);
  });
  method(ARRAY_CLASS, true, "arrayWithObjects:count:", (self, args) => {
    const pointer = alloc(self);
    for (let index = 0; index < args(1); index++) {
      items(pointer).push(retain(read(args(0) + index * WORD_BYTES)));
    }
    return autorelease(pointer);
  });
  method(ARRAY_CLASS, false, "initWithArray:", (self, args) => {
    registry.set(self, items(args(0)).map(retain));
    return self;
  });
  method(ARRAY_CLASS, false, "lastObject", (self) => items(self).at(-1) ?? 0);
  method(ARRAY_CLASS, false, "firstObject", (self) => items(self)[0] ?? 0);
  method(MUTABLE_ARRAY_CLASS, false, "removeObjectAtIndex:", (self, args) => {
    const list = items(self);
    const at = args(0);
    if (at >= list.length) throw new Error(OUT_OF_BOUNDS);
    const [value] = list.splice(at, 1);
    return value === undefined ? undefined : releaseFromHost(value);
  });
  method(MUTABLE_ARRAY_CLASS, false, "removeObjectsInArray:", async (self, args) => {
    const other = args(0);
    if (!other) return;
    let targets = registry.get(other)?.slice();
    if (!targets) {
      targets = [];
      const count = Number(await send(other, "count"));
      for (let index = 0; index < count; index++) {
        targets.push(Number(await send(other, "objectAtIndex:", [index])));
      }
    }
    for (const target of targets) {
      retain(target);
      try {
        await send(self, "removeObject:", [target]);
      } finally {
        await releaseFromHost(target);
      }
    }
  });
  method(MUTABLE_ARRAY_CLASS, false, "insertObject:atIndex:", (self, args) => {
    const pointer = args(0);
    const index = args(1);
    const list = items(self);
    if (!pointer || index > list.length) throw new Error("Invalid NSMutableArray insertion");
    list.splice(index, 0, retain(pointer));
  });
  method(ARRAY_CLASS, false, "objectAtIndex:", (self, args) => {
    const list = items(self);
    if (args(0) >= list.length) throw new Error(OUT_OF_BOUNDS);
    return list[args(0)] ?? 0;
  });
  method(SET_CLASS, false, "anyObject", (self) => registry.get(self)?.[0] ?? 0);
  method(SET_CLASS, false, "allObjects", (self) =>
    autorelease(collection(ARRAY_CLASS, [...(registry.get(self) ?? [])])),
  );
}

function installCommon(base: TouchBase, collections: Collections): void {
  const { method, read, write, destroy, releaseFromHost } = base;
  const { collections: registry } = base.state;
  for (const cls of [SET_CLASS, ARRAY_CLASS]) {
    method(cls, false, "count", (self) => collections.items(self).length);
    method(cls, false, "dealloc", async (self) => {
      const held = registry.get(self) ?? [];
      registry.delete(self);
      for (const pointer of held) await releaseFromHost(pointer);
      destroy(self);
    });
    method(cls, false, "countByEnumeratingWithState:objects:count:", (self, args) => {
      const enumeration = args(0);
      const buffer = args(1);
      const start = read(enumeration);
      const held = registry.get(self) ?? [];
      const count = Math.min(args(Argument.Third), Math.max(0, held.length - start));
      if (count) {
        for (let index = 0; index < count; index++) {
          write(buffer + index * WORD_BYTES, held[start + index] ?? 0);
        }
        write(enumeration, start + count);
        write(enumeration + ENUMERATION_ITEMS_OFFSET, buffer);
        write(enumeration + ENUMERATION_MUTATIONS_OFFSET, self);
      }
      return count;
    });
  }
}

export function installCollections(base: TouchBase, collections: Collections): void {
  installFactories(base, collections);
  installArrayMethods(base, collections);
  installCommon(base, collections);
}
