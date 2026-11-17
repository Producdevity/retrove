import { Argument, type FoundationHost, type HostMethod } from "../objc/host";

export const IndexClass = {
  Path: "NSIndexPath",
  Set: "NSIndexSet",
  MutableSet: "NSMutableIndexSet",
} as const;
/** NSNotFound on 32-bit iOS. */
export const NOT_FOUND = 0x7fffffff;
const Position = { Section: 0, Row: 1 } as const;
const HASH_MULTIPLIER = 31;
const ComparisonResult = { Ascending: -1, Same: 0, Descending: 1 } as const;

export interface IndexPaths {
  /** A new NSIndexPath with a retain count of one. */
  create(indexes: readonly number[]): number;
  indexes(pointer: number): readonly number[] | undefined;
}

export function compareIndexes(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const a = left[index] ?? 0,
      b = right[index] ?? 0;
    if (a !== b) return a < b ? ComparisonResult.Ascending : ComparisonResult.Descending;
  }
  return Math.sign(left.length - right.length);
}
function hashIndexes(indexes: readonly number[]): number {
  return indexes.reduce((hash, value) => (Math.imul(hash, HASH_MULTIPLIER) + value) >>> 0, 0);
}

function installPaths(host: FoundationHost): IndexPaths {
  const klass = host.hostClass(IndexClass.Path, "NSObject"),
    paths = new Map<number, readonly number[]>();
  const create = (indexes: readonly number[]): number => {
    const pointer = host.alloc(klass);
    paths.set(pointer, [...indexes]);
    return pointer;
  };
  const get = (self: number): readonly number[] => paths.get(self) ?? [];
  const method = (classMethod: boolean, selector: string, body: HostMethod) =>
    host.method(IndexClass.Path, classMethod, selector, body);
  method(true, "indexPathForRow:inSection:", (_klass, args) =>
    host.autorelease(create([args(Argument.Second), args(Argument.First)])),
  );
  method(true, "indexPathForItem:inSection:", (_klass, args) =>
    host.autorelease(create([args(Argument.Second), args(Argument.First)])),
  );
  method(true, "indexPathWithIndex:", (_klass, args) =>
    host.autorelease(create([args(Argument.First)])),
  );
  method(false, "init", (self) => {
    paths.set(self, []);
    return self;
  });
  method(false, "initWithIndex:", (self, args) => {
    paths.set(self, [args(Argument.First)]);
    return self;
  });
  method(false, "row", (self) => get(self)[Position.Row] ?? NOT_FOUND);
  method(false, "item", (self) => get(self)[Position.Row] ?? NOT_FOUND);
  method(false, "section", (self) => get(self)[Position.Section] ?? NOT_FOUND);
  method(false, "length", (self) => get(self).length);
  method(false, "indexAtPosition:", (self, args) => get(self)[args(Argument.First)] ?? NOT_FOUND);
  method(false, "indexPathByAddingIndex:", (self, args) =>
    host.autorelease(create([...get(self), args(Argument.First)])),
  );
  method(false, "indexPathByRemovingLastIndex", (self) =>
    host.autorelease(create(get(self).slice(0, -1))),
  );
  method(false, "compare:", (self, args) => compareIndexes(get(self), get(args(Argument.First))));
  method(false, "isEqual:", (self, args) => {
    const other = paths.get(args(Argument.First));
    return Number(other !== undefined && compareIndexes(get(self), other) === 0);
  });
  method(false, "hash", (self) => hashIndexes(get(self)));
  method(false, "copyWithZone:", (self) => host.retain(self));
  method(false, "description", (self) =>
    host.autorelease(
      host.string(`<NSIndexPath> {length = ${get(self).length}, path = ${get(self).join(" - ")}}`),
    ),
  );
  method(false, "dealloc", (self) => {
    paths.delete(self);
    host.destroy(self);
  });
  return { create, indexes: (pointer) => paths.get(pointer) };
}

function installMutableSets(
  host: FoundationHost,
  get: (self: number) => Set<number>,
  range: (location: number, length: number) => number[],
): void {
  host.method(IndexClass.MutableSet, false, "addIndex:", (self, args) => {
    get(self).add(args(Argument.First));
  });
  host.method(IndexClass.MutableSet, false, "removeIndex:", (self, args) => {
    get(self).delete(args(Argument.First));
  });
  host.method(IndexClass.MutableSet, false, "addIndexesInRange:", (self, args) => {
    for (const value of range(args(Argument.First), args(Argument.Second))) get(self).add(value);
  });
  host.method(IndexClass.MutableSet, false, "removeAllIndexes", (self) => {
    get(self).clear();
  });
}
function installSets(host: FoundationHost): void {
  const klass = host.hostClass(IndexClass.Set, "NSObject"),
    mutable = host.hostClass(IndexClass.MutableSet, IndexClass.Set),
    sets = new Map<number, Set<number>>();
  const get = (self: number): Set<number> => {
    let set = sets.get(self);
    if (!set) {
      set = new Set();
      sets.set(self, set);
    }
    return set;
  };
  const sorted = (self: number): number[] => [...get(self)].sort((a, b) => a - b);
  const range = (location: number, length: number): number[] =>
    Array.from({ length }, (_, offset) => location + offset);
  const create = (classPointer: number, values: readonly number[]): number => {
    const pointer = host.alloc(classPointer);
    sets.set(pointer, new Set(values));
    return pointer;
  };
  const method = (selector: string, body: HostMethod, classMethod = false) =>
    host.method(IndexClass.Set, classMethod, selector, body);
  method("indexSet", (self) => host.autorelease(create(self, [])), true);
  method(
    "indexSetWithIndex:",
    (self, args) => host.autorelease(create(self, [args(Argument.First)])),
    true,
  );
  method(
    "indexSetWithIndexesInRange:",
    (self, args) =>
      host.autorelease(create(self, range(args(Argument.First), args(Argument.Second)))),
    true,
  );
  method("init", (self) => {
    get(self);
    return self;
  });
  method("initWithIndex:", (self, args) => {
    sets.set(self, new Set([args(Argument.First)]));
    return self;
  });
  method("initWithIndexesInRange:", (self, args) => {
    sets.set(self, new Set(range(args(Argument.First), args(Argument.Second))));
    return self;
  });
  method("count", (self) => get(self).size);
  method("firstIndex", (self) => sorted(self)[0] ?? NOT_FOUND);
  method("lastIndex", (self) => sorted(self).at(-1) ?? NOT_FOUND);
  method("containsIndex:", (self, args) => Number(get(self).has(args(Argument.First))));
  method(
    "indexGreaterThanIndex:",
    (self, args) => sorted(self).find((value) => value > args(Argument.First)) ?? NOT_FOUND,
  );
  method(
    "indexLessThanIndex:",
    (self, args) => sorted(self).findLast((value) => value < args(Argument.First)) ?? NOT_FOUND,
  );
  method("isEqualToIndexSet:", (self, args) =>
    Number(sorted(self).join() === sorted(args(Argument.First)).join()),
  );
  method("copyWithZone:", (self) => create(klass, sorted(self)));
  method("mutableCopyWithZone:", (self) => create(mutable, sorted(self)));
  method("dealloc", (self) => {
    sets.delete(self);
    host.destroy(self);
  });
  installMutableSets(host, get, range);
}

/** NSIndexPath and NSIndexSet backed by host state. */
export function installIndexPaths(host: FoundationHost): IndexPaths {
  installSets(host);
  return installPaths(host);
}
