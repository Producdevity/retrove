import type { FoundationHost } from "../objc/host";
const MILLISECONDS_PER_SECOND = 1000;
const MAX_PROPERTY_DEPTH = 128;
const MAX_PROPERTY_ITEMS = 262144;
export const PropertyMutability = { Immutable: 0, Containers: 1, ContainersAndLeaves: 2 } as const;
interface PropertyHost {
  string(value: string, mutable?: boolean): number;
  number(value: number | boolean | bigint): number;
  date(seconds: number): number;
  data(bytes: Uint8Array, mutable?: boolean): number;
  array(values: number[], mutable?: boolean): number;
  dictionary(pairs: [number, number][], mutable?: boolean): number;
  autorelease(pointer: number): number;
}
function dictionaryValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype;
}
export function propertyValue(
  host: PropertyHost,
  value: unknown,
  mutability: number = PropertyMutability.Immutable,
): number {
  if (!Object.values(PropertyMutability).some((value) => value === mutability))
    throw new Error("Invalid property list mutability option.");
  const containers = mutability !== PropertyMutability.Immutable;
  const leaves = mutability === PropertyMutability.ContainersAndLeaves;
  let remaining = MAX_PROPERTY_ITEMS;
  function build(item: unknown, depth: number): number {
    if (--remaining < 0 || depth > MAX_PROPERTY_DEPTH)
      throw new Error("Property list exceeds traversal limit.");
    if (item === null || item === undefined) return 0;
    if (typeof item === "string") return host.string(item, leaves);
    if (typeof item === "number" || typeof item === "boolean" || typeof item === "bigint")
      return host.number(item);
    if (item instanceof Date) return host.date(item.getTime() / MILLISECONDS_PER_SECOND);
    if (item instanceof Uint8Array) return host.data(item, leaves);
    if (Array.isArray(item)) {
      const values: readonly unknown[] = item;
      return host.autorelease(
        host.array(
          values.map((v) => build(v, depth + 1)),
          containers,
        ),
      );
    }
    if (!dictionaryValue(item)) throw new Error("Unsupported property list value.");
    return host.autorelease(
      host.dictionary(
        Object.entries(item).map(([key, v]) => [host.string(key), build(v, depth + 1)]),
        containers,
      ),
    );
  }
  return build(value, 0);
}
interface PropertyFileHost extends Pick<FoundationHost, "method" | "autorelease" | "destroy"> {
  contents(path: number): Promise<Uint8Array | undefined>;
  parse(bytes: Uint8Array): unknown;
  property(value: unknown): number;
  send(pointer: number, selector: string, args: number[]): Promise<number>;
}
async function readDictionary(host: PropertyFileHost, path: number): Promise<number> {
  const bytes = await host.contents(path);
  if (!bytes) return 0;
  let parsed: unknown;
  try {
    parsed = host.parse(bytes);
  } catch {
    return 0;
  }
  if (!dictionaryValue(parsed)) return 0;
  return host.property(parsed);
}
export function installDictionaryFiles(host: PropertyFileHost): void {
  for (const url of [false, true])
    for (const factory of [false, true]) {
      const selector =
        (factory ? "dictionary" : "init") + "WithContentsOf" + (url ? "URL:" : "File:");
      host.method("NSDictionary", factory, selector, async (receiver, args) => {
        let path = args(0);
        if (url) {
          if (!path || !(await host.send(path, "isFileURL", []))) path = 0;
          else path = await host.send(path, "path", []);
        }
        const source = path ? await readDictionary(host, path) : 0;
        if (!source) {
          if (!factory) host.destroy(receiver);
          return 0;
        }
        return host.send(receiver, factory ? "dictionaryWithDictionary:" : "initWithDictionary:", [
          source,
        ]);
      });
    }
}
