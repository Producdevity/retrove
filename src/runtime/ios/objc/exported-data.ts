import { WORD_BYTES } from "../abi/scalars";
import type { CoreFoundation } from "../foundation/corefoundation";
import { LocationAccuracy } from "../services/core-location";
import type { ObjcCore } from "./core";
import { exportedStringNames } from "./exported-strings";
import type { FoundationObjects } from "./late-bindings";
import { MINIMUM_INSTANCE_SIZE } from "./class-registry";

const EXCEPTION_TYPE_PREFIX = "_OBJC_EHTYPE_$_";
const CLASS_SYMBOL = /^_OBJC_(CLASS|METACLASS)_\$_(.+)$/;
const DOUBLE_BYTES = 8;
const BOOLEANS = new Map([
  ["_kCFBooleanTrue", true],
  ["_kCFBooleanFalse", false],
]);
const LOCATION_ACCURACY = new Map(Object.entries(LocationAccuracy));
// UIBackgroundTaskInvalid is an exported integer; apps compare task identifiers against it.
const INTEGER_CONSTANTS = new Map([["_UIBackgroundTaskInvalid", 0]]);
export interface DataSources {
  readonly cf: CoreFoundation;
  readonly foundation: FoundationObjects;
  readonly networkData: (name: string) => number | undefined;
  readonly blockClasses: ReadonlyMap<string, number>;
  readonly geometryConstants: ReadonlyMap<string, number>;
  /** objc_empty_cache and objc_empty_vtable. */
  readonly emptyCache: number;
}
/** Guest words the runtime allocates once and hands out for every lookup of a symbol. */
function slots(core: ObjcCore) {
  const values = new Map<string, number>();
  return (name: string, size: number, fill: (slot: number) => void): number => {
    let slot = values.get(name);
    if (slot === undefined) {
      slot = core.memory.zero(size);
      fill(slot);
      values.set(name, slot);
    }
    return slot;
  };
}
/** Exported NSString constants live for the lifetime of the guest. */
function exportedStrings(core: ObjcCore) {
  const { memory, registry, ownership, strings } = core;
  const names = exportedStringNames(),
    addresses = new Map<string, number>();
  return (name: string): number | undefined => {
    const constant = names.get(name);
    if (!constant) return undefined;
    let address = addresses.get(constant);
    if (address === undefined) {
      const instance = strings.makeString(
        constant,
        ownership.alloc(registry.names.get("NSConstantString") ?? 0),
      );
      ownership.owned.delete(instance);
      address = memory.zero(WORD_BYTES);
      memory.write(address, instance);
      addresses.set(constant, address);
    }
    return address;
  };
}
/** Values for the scalar constants Foundation, CoreFoundation and CoreLocation export. */
function scalarData(core: ObjcCore, sources: DataSources) {
  const { memory, ownership } = core;
  const booleans = slots(core),
    integers = slots(core);
  return (name: string): number | undefined => {
    const boolean = BOOLEANS.get(name);
    if (boolean !== undefined)
      return booleans(name, WORD_BYTES, (slot) =>
        memory.write(slot, ownership.retain(sources.foundation.number(boolean))),
      );
    if (name.startsWith("_kCF")) {
      const address = sources.cf.resolveData(name);
      if (address !== null) return address;
    }
    const accuracy = LOCATION_ACCURACY.get(name);
    if (accuracy !== undefined)
      return integers(name, DOUBLE_BYTES, (slot) =>
        memory.writeBytes(slot, new Uint8Array(new Float64Array([accuracy]).buffer)),
      );
    const integer = INTEGER_CONSTANTS.get(name);
    if (integer !== undefined)
      return integers(name, WORD_BYTES, (slot) => memory.write(slot, integer));
    return sources.networkData(name);
  };
}
/** dlsym for the data symbols the guest imports from the frameworks Retrove provides. */
export function dataResolver(
  core: ObjcCore,
  sources: DataSources,
): (name: string) => number | null {
  const { memory, registry, options } = core;
  const scalar = scalarData(core, sources),
    string = exportedStrings(core);
  let defaultAllocator: number | undefined;
  return (name) => {
    if (options.cxx && name.startsWith(EXCEPTION_TYPE_PREFIX)) {
      const cls = name.slice(EXCEPTION_TYPE_PREFIX.length),
        pointer = registry.names.get(cls);
      if (pointer !== undefined) return options.cxx.objcType(cls, pointer);
    }
    const value =
      scalar(name) ?? sources.blockClasses.get(name) ?? sources.geometryConstants.get(name);
    if (value !== undefined && value !== null) return value;
    if (name === "_kCFAllocatorDefault") return (defaultAllocator ??= memory.zero(WORD_BYTES));
    const constant = string(name);
    if (constant !== undefined) return constant;
    if (name === "___CFConstantStringClassReference")
      return registry.names.get("NSConstantString") ?? null;
    if (name === "__objc_empty_cache" || name === "__objc_empty_vtable") return sources.emptyCache;
    const match = CLASS_SYMBOL.exec(name);
    if (!match) return null;
    const [, kind, className = ""] = match;
    const cls =
      registry.names.get(className) ??
      registry.hostClass(className, "NSObject", MINIMUM_INSTANCE_SIZE, false);
    return kind === "CLASS" ? cls : memory.read(cls);
  };
}
