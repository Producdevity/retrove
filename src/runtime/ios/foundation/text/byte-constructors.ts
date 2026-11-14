import type { FoundationHost, GuestArguments } from "../../objc/host";
import { decodeText } from "./encoding";
const STRING_CLASS = "NSString";
const MAX_STRING_INPUT = 67108864;
const ByteArgument = { Encoding: 2, FreeWhenDone: 3 } as const;
interface ByteHost extends Pick<FoundationHost, "method" | "destroy"> {
  readBytes(pointer: number, length: number): Uint8Array;
  freeBytes(pointer: number): void;
  initialize(pointer: number, value: string): number;
}
export function installStringBytes(host: ByteHost): void {
  const initialize = (self: number, args: GuestArguments, consume: boolean): number => {
    const pointer = args(0),
      length = args(1);
    if (length > MAX_STRING_INPUT)
      throw new RangeError("NSString byte input exceeds allocation limit.");
    if (length && !pointer) throw new Error("NSString bytes require an input buffer.");
    try {
      const value = decodeText(
        length ? host.readBytes(pointer, length) : new Uint8Array(),
        args(ByteArgument.Encoding),
      );
      if (value === null) {
        host.destroy(self);
        return 0;
      }
      return host.initialize(self, value);
    } finally {
      // NSString may copy its input; transferred buffers are no longer needed after decoding.
      if (consume && pointer) host.freeBytes(pointer);
    }
  };
  host.method(STRING_CLASS, false, "initWithBytes:length:encoding:", (self, args) =>
    initialize(self, args, false),
  );
  host.method(
    STRING_CLASS,
    false,
    "initWithBytesNoCopy:length:encoding:freeWhenDone:",
    (self, args) => initialize(self, args, Boolean(args(ByteArgument.FreeWhenDone))),
  );
}
