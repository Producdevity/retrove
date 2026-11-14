import type { GuestArguments } from "./host";
const ProtocolField = { Name: 4, Adopted: 8 } as const;
const WORD_BYTES = 4;
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
  return {
    register,
    funcs: {
      _NSStringFromProtocol: (args: GuestArguments) => (args(0) ? host.string(name(args(0))) : 0),
      _NSProtocolFromString: (args: GuestArguments) => protocols.get(host.text(args(0))) ?? 0,
      _objc_getProtocol: (args: GuestArguments) => protocols.get(host.cString(args(0))) ?? 0,
      _protocol_getName: (args: GuestArguments) =>
        args(0) ? host.read(args(0) + ProtocolField.Name) : 0,
    },
  };
}
