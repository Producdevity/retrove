import type { FoundationHost, GuestArguments } from "./host";

const AccessorArgument = {
  Self: 0,
  Offset: 2,
  Value: 3,
  Copy: 5,
  SpecializedValue: 2,
  SpecializedOffset: 3,
  GetterAtomic: 3,
} as const;
const CopyPolicy = { Retain: 0, Copy: 1, MutableCopy: 2 } as const;
const BYTE_MASK = 0xff;

interface PropertyHost {
  read(address: number): number;
  write(address: number, value: number): void;
  retain(pointer: number): number;
  release(pointer: number): Promise<void>;
  autorelease(pointer: number): number;
  send(pointer: number, selector: string, arguments_: number[]): Promise<number>;
}

export function propertyAccessors(host: PropertyHost) {
  async function set(self: number, offset: number, replacement: number, policy: number) {
    if (offset === 0) {
      if (self) host.write(self, replacement);
      return;
    }
    const slot = (self + (offset | 0)) >>> 0;
    let value: number;
    if (policy === CopyPolicy.Retain) {
      if (host.read(slot) === replacement) return;
      value = host.retain(replacement);
    } else {
      const selector = policy === CopyPolicy.MutableCopy ? "mutableCopyWithZone:" : "copyWithZone:";
      value = await host.send(replacement, selector, [0]);
    }
    // Guest threads are cooperative: the slot exchange must not yield.
    const previous = host.read(slot);
    host.write(slot, value);
    await host.release(previous);
  }
  const specialized = (policy: number) => (args: GuestArguments) =>
    set(
      args(AccessorArgument.Self),
      args(AccessorArgument.SpecializedOffset),
      args(AccessorArgument.SpecializedValue),
      policy,
    );
  return {
    _objc_getProperty(args: GuestArguments) {
      const self = args(AccessorArgument.Self);
      const offset = args(AccessorArgument.Offset);
      if (offset === 0) return self ? host.read(self) : 0;
      const value = host.read((self + (offset | 0)) >>> 0);
      return args(AccessorArgument.GetterAtomic) ? host.autorelease(host.retain(value)) : value;
    },
    _objc_setProperty(args: GuestArguments) {
      return set(
        args(AccessorArgument.Self),
        args(AccessorArgument.Offset),
        args(AccessorArgument.Value),
        args(AccessorArgument.Copy) & BYTE_MASK,
      );
    },
    _objc_setProperty_atomic: specialized(CopyPolicy.Retain),
    _objc_setProperty_nonatomic: specialized(CopyPolicy.Retain),
    _objc_setProperty_atomic_copy: specialized(CopyPolicy.Copy),
    _objc_setProperty_nonatomic_copy: specialized(CopyPolicy.Copy),
  };
}

const StructArgument = { Destination: 0, Source: 1, Size: 2 } as const;
const STRUCT_COPY_CHUNK_BYTES = 65536;
interface StructCopyHost {
  readBytes(pointer: number, length: number): Uint8Array;
  writeBytes(pointer: number, bytes: Uint8Array): void;
}
export function structCopyImports(
  host: StructCopyHost,
): Record<string, (args: GuestArguments) => void> {
  return {
    _objc_copyStruct: (args) => {
      const destination = args(StructArgument.Destination),
        source = args(StructArgument.Source),
        length = args(StructArgument.Size) | 0;
      if (length < 0) throw new RangeError("Negative Objective-C struct copy size.");
      if (!length || source === destination) return;
      const backwards = destination > source && destination < source + length;
      // Synchronous copies cannot yield to another cooperative guest thread.
      for (let copied = 0; copied < length;) {
        const count = Math.min(STRUCT_COPY_CHUNK_BYTES, length - copied),
          offset = backwards ? length - copied - count : copied;
        host.writeBytes(destination + offset, host.readBytes(source + offset, count));
        copied += count;
      }
    },
  };
}

export function installUnobservedPropertyChanges(
  host: Pick<FoundationHost, "method" | "text"> & { changed?(self: number): Promise<void> },
): void {
  // Observer registration is unavailable; manual notifications have no recipients.
  for (const selector of ["willChangeValueForKey:", "didChangeValueForKey:"])
    host.method("NSObject", false, selector, async (self, args) => {
      host.text(args(0));
      if (selector === "didChangeValueForKey:") await host.changed?.(self);
    });
}
