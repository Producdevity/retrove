import type { GuestArguments, HostMethod, HostResult, StructureMethod } from "./host";

export type MethodImplementation = HostMethod | StructureMethod;
export type Implementation = number | MethodImplementation | null;
export type MethodRegistrar = (
  className: string,
  classMethod: boolean,
  selector: string,
  implementation: MethodImplementation,
) => void;
export type HostRegistrar = (
  className: string,
  classMethod: boolean,
  selector: string,
  implementation: HostMethod,
) => void;
export type StructureRegistrar = (
  className: string,
  classMethod: boolean,
  selector: string,
  implementation: StructureMethod,
) => void;
/** Runs a guest or host method found by `lookup`, as the runtime would for a super call. */
export function callImplementation(
  implementation: Implementation,
  self: number,
  args: GuestArguments,
): HostResult | Promise<HostResult> {
  if (typeof implementation !== "function") throw new Error("Expected a host method.");
  if ("stret" in implementation) throw new Error("Expected a non-structure host method.");
  return implementation(self, args);
}
