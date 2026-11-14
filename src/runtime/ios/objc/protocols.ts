import type { GuestArguments } from "./host";
const ProtocolField = { Name: 4, Adopted: 8 } as const;
const WORD_BYTES = 4;
const ClassField = { Superclass: 4, Data: 16, Protocols: 24 } as const;
const CLASS_DATA_FLAGS = 3;
const MAX_PROTOCOLS = 65_536;
interface ProtocolHost {
  read(pointer: number): number;
  cString(pointer: number): string;
  string(value: string): number;
  text(pointer: number): string;
}
export function protocolImports(host: ProtocolHost) {
  const protocols = new Map<string, number>();
  const name = (pointer: number) =>
    pointer ? host.cString(host.read(pointer + ProtocolField.Name)) : "";
  function register(pointer: number): void {
    if (!pointer) return;
    const key = name(pointer);
    if (protocols.has(key)) return;
    protocols.set(key, pointer);
    const adopted = host.read(pointer + ProtocolField.Adopted);
    if (!adopted) return;
    const count = host.read(adopted);
    if (count > MAX_PROTOCOLS) throw new Error("Invalid Objective-C protocol list.");
    for (let index = 0; index < count; index++)
      register(host.read(adopted + WORD_BYTES + index * WORD_BYTES));
  }
  function adopts(pointer: number, target: number, seen = new Set<number>()): boolean {
    if (!pointer || seen.has(pointer)) return false;
    if (pointer === target || name(pointer) === name(target)) return true;
    seen.add(pointer);
    const list = host.read(pointer + ProtocolField.Adopted);
    if (!list) return false;
    const count = host.read(list);
    if (count > MAX_PROTOCOLS) throw new Error("Invalid Objective-C protocol list.");
    for (let index = 0; index < count; index++)
      if (adopts(host.read(list + WORD_BYTES + index * WORD_BYTES), target, seen)) return true;
    return false;
  }
  function conforms(klass: number, target: number): boolean {
    if (!target) return false;
    const seen = new Set<number>();
    for (
      let pointer = klass;
      pointer && !seen.has(pointer);
      pointer = host.read(pointer + ClassField.Superclass)
    ) {
      seen.add(pointer);
      const data = host.read(pointer + ClassField.Data) & ~CLASS_DATA_FLAGS;
      const list = data ? host.read(data + ClassField.Protocols) : 0;
      if (!list) continue;
      const count = host.read(list);
      if (count > MAX_PROTOCOLS) throw new Error("Invalid Objective-C class protocol list.");
      for (let index = 0; index < count; index++)
        if (adopts(host.read(list + WORD_BYTES + index * WORD_BYTES), target)) return true;
    }
    return false;
  }
  return {
    register,
    conforms,

    funcs: {
      _class_conformsToProtocol: (args: GuestArguments) => Number(conforms(args(0), args(1))),
      _NSStringFromProtocol: (args: GuestArguments) => (args(0) ? host.string(name(args(0))) : 0),
      _NSProtocolFromString: (args: GuestArguments) => protocols.get(host.text(args(0))) ?? 0,
      _objc_getProtocol: (args: GuestArguments) => protocols.get(host.cString(args(0))) ?? 0,
      _protocol_getName: (args: GuestArguments) =>
        args(0) ? host.read(args(0) + ProtocolField.Name) : 0,
    },
  };
}
