import { StringEncoding } from "./text/encoding";
import type { FoundationHost } from "../objc/host";
const STRING_CLASS = "NSString";
export const DEFAULT_C_STRING_ENCODING = StringEncoding.UTF8;
interface CStringHost extends Pick<FoundationHost, "method" | "alloc" | "autorelease" | "destroy"> {
  bytes(pointer: number): Uint8Array;
  decode(bytes: Uint8Array, encoding: number): string | null;
  initialize(pointer: number, text: string): number;
  utf8(pointer: number): number;
}
export function installCStringConstructors(host: CStringHost): void {
  host.method(STRING_CLASS, true, "string", (cls) =>
    host.autorelease(host.initialize(host.alloc(cls), "")),
  );
  host.method(STRING_CLASS, false, "init", (self) => host.initialize(self, ""));
  host.method(STRING_CLASS, true, "defaultCStringEncoding", () => DEFAULT_C_STRING_ENCODING);
  for (const [name, explicit] of [
    ["CString:", false],
    ["UTF8String:", false],
    ["CString:encoding:", true],
  ] as const) {
    const decode = (pointer: number, encoding: number): string | null =>
      pointer ? host.decode(host.bytes(pointer), encoding) : null;
    host.method(STRING_CLASS, true, "stringWith" + name, (cls, args) => {
      const value = decode(args(0), explicit ? args(1) : DEFAULT_C_STRING_ENCODING);
      return value === null ? 0 : host.autorelease(host.initialize(host.alloc(cls), value));
    });
    host.method(STRING_CLASS, false, "initWith" + name, (self, args) => {
      const value = decode(args(0), explicit ? args(1) : DEFAULT_C_STRING_ENCODING);
      if (value === null) {
        host.destroy(self);
        return 0;
      }
      return host.initialize(self, value);
    });
  }
  host.method(STRING_CLASS, false, "cString", (self) => host.utf8(self));
}
