import { Argument, type FoundationHost } from "../objc/host";
const VALUE_CLASS = "NSValue";
const Encoding = { Pointer: "^v", Object: "@" } as const;
interface Box {
  readonly value: number;
  readonly encoding: string;
}
interface ValueHost extends FoundationHost {
  cString(value: string): number;
}
export function installValues(host: ValueHost): void {
  host.hostClass(VALUE_CLASS, "NSObject");
  const values = new Map<number, Box>();
  const encodings = new Map<string, number>();
  const get = (self: number): Box => {
    const box = values.get(self);
    if (!box) throw new Error("NSValue has no supported boxed value.");
    return box;
  };
  for (const [factory, getter, encoding] of [
    ["valueWithPointer:", "pointerValue", Encoding.Pointer],
    ["valueWithNonretainedObject:", "nonretainedObjectValue", Encoding.Object],
  ] as const) {
    host.method(VALUE_CLASS, true, factory, (klass, args) => {
      const pointer = host.alloc(klass);
      values.set(pointer, { value: args(Argument.First), encoding });
      return host.autorelease(pointer);
    });
    host.method(VALUE_CLASS, false, getter, (self) => {
      const box = get(self);
      if (box.encoding !== encoding) throw new Error("NSValue has a different boxed type.");
      return box.value;
    });
  }
  host.method(VALUE_CLASS, false, "getValue:", (self, args) =>
    host.write(args(Argument.First), get(self).value),
  );
  host.method(VALUE_CLASS, false, "objCType", (self) => {
    const encoding = get(self).encoding;
    let pointer = encodings.get(encoding);
    if (pointer === undefined) {
      pointer = host.cString(encoding);
      encodings.set(encoding, pointer);
    }
    return pointer;
  });
  for (const name of ["copy", "copyWithZone:"])
    host.method(VALUE_CLASS, false, name, (self) => host.retain(self));
  host.method(VALUE_CLASS, false, "isEqualToValue:", (self, args) => {
    if (self === args(Argument.First)) return 1;
    const left = get(self),
      right = values.get(args(Argument.First));
    return Number(left.value === right?.value && left.encoding === right.encoding);
  });
  host.method(VALUE_CLASS, false, "dealloc", (self) => {
    values.delete(self);
    host.destroy(self);
  });
}
