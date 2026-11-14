import type { FoundationHost, HostResult } from "../objc/host";
const ARRAY_CLASS = "NSArray";
interface ArrayHost extends Pick<FoundationHost, "method" | "autorelease"> {
  items(pointer: number): readonly number[];
  array(items: readonly number[]): number;
  send(pointer: number, selector: string, args: number[]): Promise<HostResult>;
}
function word(value: HostResult): number {
  if (typeof value !== "number") throw new Error("Expected an Objective-C word result.");
  return value;
}
export function installArrayMethods(host: ArrayHost): void {
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
