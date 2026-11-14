import type { FoundationHost, HostResult } from "../objc/host";
import { NOT_FOUND } from "./string-search";
const ARRAY_CLASS = "NSArray";
interface ArrayHost extends Pick<FoundationHost, "method" | "autorelease" | "retain" | "release"> {
  selectorName(pointer: number): string;
  items(pointer: number): readonly number[];
  array(items: readonly number[]): number;
  send(pointer: number, selector: string, args: number[]): Promise<HostResult>;
}
function word(value: HostResult): number {
  if (typeof value !== "number") throw new Error("Expected an Objective-C word result.");
  return value;
}
export function installArrayMethods(host: ArrayHost): void {
  for (const [selector, withObject] of [
    ["makeObjectsPerformSelector:", false],
    ["makeObjectsPerformSelector:withObject:", true],
  ] as const)
    host.method(ARRAY_CLASS, false, selector, async (self, args) => {
      if (!args(0)) throw new Error("Array selector is nil.");
      const name = host.selectorName(args(0)),
        values: number[] = [];
      try {
        const count = word(await host.send(self, "count", []));
        for (let index = 0; index < count; index++)
          values.push(host.retain(word(await host.send(self, "objectAtIndex:", [index]))));
        for (const value of values) await host.send(value, name, withObject ? [args(1)] : []);
      } finally {
        for (const value of values) await host.release(value);
      }
    });
  for (const [selector, identity] of [
    ["indexOfObject:", false],
    ["indexOfObjectIdenticalTo:", true],
  ] as const)
    host.method(ARRAY_CLASS, false, selector, async (self, args) => {
      const count = word(await host.send(self, "count", [])),
        object = args(0);
      for (let index = 0; index < count; index++) {
        const value = word(await host.send(self, "objectAtIndex:", [index]));
        if (value === object || (!identity && word(await host.send(value, "isEqual:", [object]))))
          return index;
      }
      return NOT_FOUND;
    });
  host.method("NSMutableArray", false, "addObjectsFromArray:", async (self, args) => {
    const values = [...host.items(args(0))];
    for (const value of values) await host.send(self, "addObject:", [value]);
  });
  host.method("NSMutableArray", false, "removeLastObject", async (self) => {
    const count = word(await host.send(self, "count", []));
    if (count) return host.send(self, "removeObjectAtIndex:", [count - 1]);
    return undefined;
  });
  host.method(ARRAY_CLASS, true, "arrayWithArray:", async (cls, args) => {
    const source = args(0),
      receiver = word(await host.send(cls, "alloc", []));
    return host.autorelease(word(await host.send(receiver, "initWithArray:", [source])));
  });
  host.method(ARRAY_CLASS, false, "arrayByAddingObject:", (self, args) => {
    const object = args(0);
    if (!object) throw new Error("Cannot add nil to NSArray.");
    return host.autorelease(host.array([...host.items(self), object]));
  });
  host.method(ARRAY_CLASS, false, "arrayByAddingObjectsFromArray:", (self, args) =>
    host.autorelease(host.array([...host.items(self), ...host.items(args(0))])),
  );
}
