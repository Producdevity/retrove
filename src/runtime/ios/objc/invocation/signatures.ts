import type { FoundationHost } from "../host";
import { parseMethodEncoding, type MethodEncoding } from "./encoding";
export const SIGNATURE_CLASS = "NSMethodSignature";
export interface SignatureHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "alloc" | "autorelease" | "destroy"
> {
  cString(pointer: number): string;
  permanentString(value: string): number;
  methodEncoding(receiver: number, selector: number, instance: boolean): string | undefined;
}
export function installSignatures(host: SignatureHost) {
  const cls = host.hostClass(SIGNATURE_CLASS, "NSObject"),
    signatures = new Map<number, MethodEncoding>();
  const create = (encoding: string) => {
    const signature = parseMethodEncoding(encoding),
      self = host.alloc(cls);
    signatures.set(self, signature);
    return self;
  };
  const get = (self: number): MethodEncoding => {
    const value = signatures.get(self);
    if (!value) throw new Error("Invalid NSMethodSignature.");
    return value;
  };
  host.method(SIGNATURE_CLASS, true, "signatureWithObjCTypes:", (_, args) =>
    host.autorelease(create(host.cString(args(0)))),
  );
  host.method(SIGNATURE_CLASS, false, "numberOfArguments", (self) => get(self).arguments.length);
  host.method(SIGNATURE_CLASS, false, "frameLength", (self) => get(self).frameLength);
  host.method(SIGNATURE_CLASS, false, "methodReturnLength", (self) => get(self).result.size);
  host.method(SIGNATURE_CLASS, false, "methodReturnType", (self) =>
    host.permanentString(get(self).result.encoding),
  );
  host.method(SIGNATURE_CLASS, false, "isOneway", (self) => Number(get(self).oneway));
  host.method(SIGNATURE_CLASS, false, "getArgumentTypeAtIndex:", (self, args) => {
    const type = get(self).arguments[args(0)];
    if (!type) throw new Error("NSMethodSignature argument index out of range.");
    return host.permanentString(type.encoding);
  });
  host.method(SIGNATURE_CLASS, false, "dealloc", (self) => {
    signatures.delete(self);
    host.destroy(self);
  });
  for (const meta of [false, true]) {
    host.method("NSObject", meta, "methodSignatureForSelector:", (self, args) => {
      const encoding = host.methodEncoding(self, args(0), false);
      return encoding ? host.autorelease(create(encoding)) : 0;
    });
  }
  host.method("NSObject", true, "instanceMethodSignatureForSelector:", (self, args) => {
    const encoding = host.methodEncoding(self, args(0), true);
    return encoding ? host.autorelease(create(encoding)) : 0;
  });
  return { get };
}
