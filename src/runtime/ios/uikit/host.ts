import type { IpaArchive } from "../../../../web/ipa.mjs";
import type { FoundationHost, GuestArguments, HostResult } from "../objc/host";

export type Rectangle = [number, number, number, number];
export interface ViewState {
  frame: Rectangle;
  bounds: Rectangle;
  interactive: boolean;
  needsDisplay: boolean;
  needsLayout: boolean;
}
export interface StructureMethod {
  (self: number, arguments_: GuestArguments, destination: number): void;
  stret: true;
}
export interface UIKitHost extends FoundationHost {
  structure(
    className: string,
    classMethod: boolean,
    selector: string,
    implementation: StructureMethod,
  ): void;
  send(
    self: number,
    selector: string,
    arguments_?: number[],
    optional?: boolean,
  ): Promise<HostResult>;
  read(address: number): number;
  view(pointer: number): ViewState;
  setFrame(pointer: number, frame: Rectangle): number;
  deallocateView(pointer: number): Promise<void>;
  readonly ipa: Pick<IpaArchive, "info" | "bundlePath" | "has" | "read">;
  readonly document?: Document;
}
export const UIKitClass = {
  Font: "UIFont",
  Label: "UILabel",
  View: "UIView",
  Object: "NSObject",
  String: "NSString",
} as const;
export function structureMethod(
  implementation: (self: number, args: GuestArguments, destination: number) => void,
): StructureMethod {
  return Object.assign(implementation, { stret: true as const });
}
export function objectResult(value: HostResult): number {
  if (typeof value !== "number") throw new Error("Expected an Objective-C object pointer.");
  return value;
}
