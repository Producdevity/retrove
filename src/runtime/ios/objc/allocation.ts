import type { FoundationHost } from "./host";
const OBJECT_CLASS = "NSObject";
const Selector = {
  Alloc: "alloc",
  AllocWithZone: "allocWithZone:",
  Initialize: "init",
  New: "new",
} as const;
interface AllocationHost extends Pick<FoundationHost, "method"> {
  allocate(type: number): Promise<number>;
  send(receiver: number, selector: string, arguments_: number[]): Promise<number>;
}
export function installObjectAllocation(host: AllocationHost): void {
  host.method(OBJECT_CLASS, true, Selector.Alloc, (type) =>
    host.send(type, Selector.AllocWithZone, [0]),
  );
  host.method(OBJECT_CLASS, true, Selector.AllocWithZone, (type) => host.allocate(type));
  host.method(OBJECT_CLASS, true, Selector.New, async (type) =>
    host.send(await host.send(type, Selector.Alloc, []), Selector.Initialize, []),
  );
}
