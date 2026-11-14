import type { FoundationHost, HostResult } from "../objc/host";
const Collection = { Dictionary: "NSDictionary", Array: "NSArray" } as const;
const MAX_DEPTH = 128;
interface EqualityHost extends Pick<FoundationHost, "method"> {
  isKind(pointer: number, className: string): boolean;
  entries(pointer: number): ReadonlyArray<readonly [number, number]>;
  items(pointer: number): readonly number[];
  send(self: number, selector: string, args: number[]): Promise<HostResult>;
}
export function installCollectionEquality(host: EqualityHost): void {
  async function equal(left: number, right: number, depth: number): Promise<boolean> {
    if (left === right) return true;
    if (!left || !right) return false;
    if (depth > MAX_DEPTH) throw new Error("Collection equality exceeds nesting limit.");
    if (host.isKind(left, Collection.Dictionary)) return dictionary(left, right, depth + 1);
    if (host.isKind(left, Collection.Array)) return array(left, right, depth + 1);
    return Boolean(await host.send(left, "isEqual:", [right]));
  }
  async function dictionary(left: number, right: number, depth: number): Promise<boolean> {
    if (!host.isKind(right, Collection.Dictionary)) return false;
    const entries = host.entries(left),
      others = [...host.entries(right)];
    if (entries.length !== others.length) return false;
    for (const [key, value] of entries) {
      let found = false;
      for (const [index, [otherKey, otherValue]] of others.entries())
        if (await equal(key, otherKey, depth)) {
          if (!(await equal(value, otherValue, depth))) return false;
          others.splice(index, 1);
          found = true;
          break;
        }
      if (!found) return false;
    }
    return true;
  }
  async function array(left: number, right: number, depth: number): Promise<boolean> {
    if (!host.isKind(right, Collection.Array)) return false;
    const values = host.items(left),
      others = host.items(right);
    if (values.length !== others.length) return false;
    for (const [index, value] of values.entries()) {
      const other = others[index];
      if (other === undefined || !(await equal(value, other, depth))) return false;
    }
    return true;
  }
  for (const [type, selector] of [
    [Collection.Dictionary, "isEqualToDictionary:"],
    [Collection.Array, "isEqualToArray:"],
  ] as const)
    for (const method of [selector, "isEqual:"])
      host.method(type, false, method, async (self, args) => Number(await equal(self, args(0), 0)));
}
