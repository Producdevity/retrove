import type { FoundationHost } from "../objc/host";
const ARRAY_CLASS = "NSArray";
interface ArrayHost extends Pick<FoundationHost, "method" | "autorelease"> {
  items(pointer: number): readonly number[];
  array(items: readonly number[]): number;
}
export function installArrayCopies(host: ArrayHost): void {
  host.method(ARRAY_CLASS, false, "arrayByAddingObject:", (self, args) => {
    const object = args(0);
    if (!object) throw new Error("Cannot add nil to NSArray.");
    return host.autorelease(host.array([...host.items(self), object]));
  });
  host.method(ARRAY_CLASS, false, "arrayByAddingObjectsFromArray:", (self, args) =>
    host.autorelease(host.array([...host.items(self), ...host.items(args(0))])),
  );
}
