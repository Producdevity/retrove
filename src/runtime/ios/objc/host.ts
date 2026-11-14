export type GuestArguments = (index: number) => number;
export type HostResult = number | bigint | void;
export type HostMethod = (
  self: number,
  arguments_: GuestArguments,
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
export const Argument = { First: 0, Second: 1, Third: 2 } as const;
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
