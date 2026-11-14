import type { FoundationHost, GuestArguments, HostResult } from "../../objc/host";
export const OperationClass = {
  Base: "NSOperation",
  Invocation: "NSInvocationOperation",
  Queue: "NSOperationQueue",
} as const;
export interface OperationHost extends FoundationHost {
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
  isKind(self: number, className: string): boolean;
  selector(pointer: number): string;
  returnType(self: number, selector: string): string;
  array(items: number[]): number;
  items(pointer: number): number[];
  worker(operation: number, task: () => Promise<void>, exited: () => Promise<void>): void;
  waitMethod(
    className: string,
    selector: string,
    method: (self: number, args: GuestArguments) => Promise<{ wait(): number | undefined }>,
  ): void;
}
export function pointer(value: HostResult): number {
  if (typeof value !== "number") throw new Error("Expected an Objective-C object result.");
  return value;
}
