import { Argument, type FoundationHost } from "../objc/host";
import { PropertyMutability } from "./property-lists";
const SERIALIZATION_CLASS = "NSPropertyListSerialization";
const ERROR_ARGUMENT = 3;
const Format = { XML: 100, Binary: 200 } as const;
const BINARY_PREFIX = new TextEncoder().encode("bplist00");
const INVALID_PLIST = 3840;
interface SerializationHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "string" | "retain" | "write"
> {
  bytes(pointer: number): Uint8Array;
  parse(bytes: Uint8Array): unknown;
  property(value: unknown, mutability: number): number;
  error(code: number, domain: string): number;
}
export function installPropertyListSerialization(host: SerializationHost): void {
  host.hostClass(SERIALIZATION_CLASS, "NSObject");
  for (const [selector, legacy] of [
    ["propertyListFromData:mutabilityOption:format:errorDescription:", true],
    ["propertyListWithData:options:format:error:", false],
  ] as const)
    host.method(SERIALIZATION_CLASS, true, selector, (_, args) => {
      try {
        const bytes = host.bytes(args(Argument.First));
        const options = args(Argument.Second);
        if (!Object.values(PropertyMutability).some((value) => value === options))
          throw new Error("Invalid property list mutability option.");
        const parsed = host.parse(bytes);
        const value = host.property(parsed, options);
        if (args(Argument.Third))
          host.write(
            args(Argument.Third),
            BINARY_PREFIX.every((byte, index) => bytes[index] === byte)
              ? Format.Binary
              : Format.XML,
          );
        return value;
      } catch (error) {
        if (args(ERROR_ARGUMENT))
          host.write(
            args(ERROR_ARGUMENT),
            legacy
              ? host.retain(
                  host.string(error instanceof Error ? error.message : "Invalid property list."),
                )
              : host.error(INVALID_PLIST, "NSCocoaErrorDomain"),
          );
        return 0;
      }
    });
}
