import type { GuestArguments } from "./host";
const Field = { Superclass: 4, Data: 16, InstanceSize: 8, Name: 16, Flags: 0 } as const;
const DATA_FLAGS = 3;
const META_FLAG = 1;
interface ReflectionHost {
  read(pointer: number): number;
  cString(value: string): number;
}
export function reflectionImports(host: ReflectionHost) {
  const data = (klass: number) => host.read(klass + Field.Data) & ~DATA_FLAGS;
  const name = (klass: number) =>
    klass ? host.read(data(klass) + Field.Name) : host.cString("nil");
  return {
    _class_getName: (args: GuestArguments) => name(args(0)),
    _object_getClassName: (args: GuestArguments) => name(args(0) ? host.read(args(0)) : 0),
    _class_getSuperclass: (args: GuestArguments) =>
      args(0) ? host.read(args(0) + Field.Superclass) : 0,
    _class_isMetaClass: (args: GuestArguments) =>
      args(0) ? Number(Boolean(host.read(data(args(0)) + Field.Flags) & META_FLAG)) : 0,
    _class_getInstanceSize: (args: GuestArguments) =>
      args(0) ? host.read(data(args(0)) + Field.InstanceSize) : 0,
  };
}
