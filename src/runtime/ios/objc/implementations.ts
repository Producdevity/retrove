import type {
  FoundationHost,
  GuestArguments,
  HostMethod,
  HostResult,
  StructureMethod,
} from "./host";
type Implementation = HostMethod | StructureMethod;
const IMP_ARGUMENT = {
  Output: 0,
  Receiver: 0,
  Selector: 1,
  First: 2,
  StructureReceiver: 1,
  StructureFirst: 3,
} as const;
interface ImplementationHost extends Pick<FoundationHost, "method"> {
  isa(pointer: number): number;
  selector(pointer: number): string;
  lookup(classPointer: number, selector: string): number | Implementation | null;
  gate(name: string, callback: (args: GuestArguments) => Promise<HostResult>): number;
}
export type MethodValue = number | Implementation;
/** Installs the IMP getters and returns the guest address for any method value. */
export function installImplementationLookup(host: ImplementationHost): {
  address(implementation: MethodValue, name: string): number;
} {
  const addresses = new WeakMap<Implementation, number>();
  const resolve = (klass: number, name: string): number => {
    const implementation = host.lookup(klass, name);
    if (!implementation) throw new Error(`Cannot obtain implementation of ${name}.`);
    return address(implementation, name);
  };
  const address = (implementation: MethodValue, name: string): number => {
    if (typeof implementation === "number") return implementation;
    const existing = addresses.get(implementation);
    if (existing) return existing;
    const pointer = host.gate(name, async (args) => {
      if ("stret" in implementation) {
        const destination = args(IMP_ARGUMENT.Output);
        await implementation(
          args(IMP_ARGUMENT.StructureReceiver),
          (index) => args(index + IMP_ARGUMENT.StructureFirst),
          destination,
        );
        return destination;
      }
      return implementation(args(IMP_ARGUMENT.Receiver), (index) =>
        args(index + IMP_ARGUMENT.First),
      );
    });
    addresses.set(implementation, pointer);
    return pointer;
  };
  host.method("NSObject", true, "instanceMethodForSelector:", (self, args) =>
    resolve(self, host.selector(args(0))),
  );
  for (const meta of [true, false])
    host.method("NSObject", meta, "methodForSelector:", (self, args) =>
      resolve(host.isa(self), host.selector(args(0))),
    );
  return { address };
}
