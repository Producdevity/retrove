import type { GuestArguments } from "./host";
const Argument = { Output: 0, Protocol: 1, Selector: 2, Required: 3, Instance: 4 } as const;
const STRIDE_MASK = 0xffff;
const Field = {
  Adopted: 8,
  RequiredInstance: 12,
  RequiredClass: 16,
  OptionalInstance: 20,
  OptionalClass: 24,
} as const;
const Layout = {
  Word: 4,
  ListHeader: 8,
  MethodBytes: 12,
  Name: 0,
  Types: 4,
  MaximumCount: 65_536,
} as const;
interface ProtocolMethodHost {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
  cString(pointer: number): string;
  selector(value: string): number;
}
export function protocolMethodImports(host: ProtocolMethodHost) {
  const find = (
    protocol: number,
    selector: string,
    required: boolean,
    instance: boolean,
    seen: Set<number>,
  ): number => {
    if (!protocol || seen.has(protocol)) return 0;
    seen.add(protocol);
    const field = required
      ? instance
        ? Field.RequiredInstance
        : Field.RequiredClass
      : instance
        ? Field.OptionalInstance
        : Field.OptionalClass;
    const list = host.read(protocol + field);
    if (list) {
      const stride = host.read(list) & STRIDE_MASK,
        count = host.read(list + Layout.Word);
      if (stride !== Layout.MethodBytes || count > Layout.MaximumCount)
        throw new Error("Invalid Objective-C protocol method list.");
      for (let index = 0; index < count; index++) {
        const entry = list + Layout.ListHeader + index * stride;
        if (host.cString(host.read(entry + Layout.Name)) === selector) return entry;
      }
    }
    const adopted = host.read(protocol + Field.Adopted);
    if (!adopted) return 0;
    const count = host.read(adopted);
    if (count > Layout.MaximumCount) throw new Error("Invalid Objective-C adopted protocol list.");
    for (let index = 0; index < count; index++) {
      const entry = find(
        host.read(adopted + Layout.Word + index * Layout.Word),
        selector,
        required,
        instance,
        seen,
      );
      if (entry) return entry;
    }
    return 0;
  };
  return {
    _protocol_getMethodDescription: (args: GuestArguments) => {
      const output = args(Argument.Output),
        entry = find(
          args(Argument.Protocol),
          host.cString(args(Argument.Selector)),
          Boolean(args(Argument.Required)),
          Boolean(args(Argument.Instance)),
          new Set(),
        );
      host.write(output, entry ? host.selector(host.cString(host.read(entry))) : 0);
      host.write(output + Layout.Word, entry ? host.read(entry + Layout.Types) : 0);
      return output;
    },
  };
}
