import type { GuestLandingPad } from "../../cxx/landing-pad";
export type GuestArguments = (index: number) => number;
/** Continue at a guest IMP with the registers the host prepared, as a tail call. */
export interface GuestJump {
  readonly jump: number;
}
/** Blocks the calling guest thread until `wait` returns a value. */
export interface HostWait {
  wait(): unknown;
}
export type HostResult = number | bigint | void | GuestJump | HostWait | GuestLandingPad;
export type HostMethod = (
  self: number,
  arguments_: GuestArguments,
  destination?: number,
) => HostResult | Promise<HostResult>;
export interface FoundationHost {
  hostClass(name: string, parent: string, instanceSize?: number): number;
  method(
    className: string,
    classMethod: boolean,
    selector: string,
    implementation: HostMethod,
  ): void;
  alloc(classPointer: number): number;
  destroy(pointer: number): void;
  retain(pointer: number): number;
  release(pointer: number): Promise<void>;
  autorelease(pointer: number): number;
  text(pointer: number): string;
  string(value: string): number;
  write(address: number, value: number): void;
}
export const Argument = { First: 0, Second: 1, Third: 2, Fourth: 3 } as const;
export const FoundationClass = {
  Object: "NSObject",
  CharacterSet: "NSCharacterSet",
  Scanner: "NSScanner",
} as const;

export function zoneCopySelector(selector: string): string | undefined {
  switch (selector) {
    case "copy":
      return "copyWithZone:";
    case "mutableCopy":
      return "mutableCopyWithZone:";
    default:
      return undefined;
  }
}

export interface StructureMethod {
  (self: number, arguments_: GuestArguments, destination: number): void | Promise<void>;
  stret: true;
}
