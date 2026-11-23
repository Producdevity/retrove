import type { GuestMemory } from "../../../memory/guest-memory";
import type { FoundationHost, GuestArguments, HostResult } from "../../objc/host";

export type Pair = [key: number, value: number];
export const Argument = { First: 0, Second: 1, Third: 2, Fourth: 3, Fifth: 4 } as const;
/** Indices into the callbacks captured from CFArrayCallBacks and CFDictionary*CallBacks. */
export const CallbackSlot = { Retain: 0, Release: 1, Description: 2, Equal: 3 } as const;

export interface FoundationBridge {
  readonly description: (pointer: number) => string;
  readonly number: (value: number | boolean) => number;
  readonly unbox: (pointer: number) => unknown;
  readonly get: (pointer: number, key: number) => number;
  readonly associated: (pointer: number, key: number, value: number) => Promise<void>;
}
export type CoreFoundationFunction = (a: GuestArguments) => HostResult | Promise<HostResult>;
export interface CoreFoundationHost {
  readonly cpu: GuestMemory;
  readonly hostClass: FoundationHost["hostClass"];
  readonly method: FoundationHost["method"];
  readonly alloc: (classPointer: number) => number;
  readonly destroy: (pointer: number) => void;
  readonly retain: (pointer: number) => number;
  readonly release: (pointer: number) => Promise<void>;
  readonly autorelease: (pointer: number) => number;
  readonly text: (pointer: number) => string;
  readonly write: (address: number, value: number) => void;
  readonly read: (address: number) => number;
  readonly zero: (bytes: number) => number;
  readonly names: ReadonlyMap<string, number>;
  readonly send: (self: number, selector: string, args?: number[]) => Promise<HostResult>;
  readonly callGuest: (target: number, args: number[]) => Promise<number>;
  readonly hostGate: (info: { name: string }, handler: (a: GuestArguments) => unknown) => number;
  readonly makeString: (value: string, target?: number) => number;
  readonly makeUTF16: (bytes: Uint8Array, target?: number) => number;
  readonly foundation: FoundationBridge;
  readonly items: (pointer: number) => number[];
  readonly getRunLoop: () => number;
  readonly equal?: (left: number, right: number) => unknown;
  readonly hash?: (value: number) => unknown;
}
export interface CoreFoundation {
  readonly funcs: Record<string, CoreFoundationFunction>;
  resolveData(name: string): number | null;
  dictionaryEntries(pointer: number): Pair[] | undefined;
}

export function classPointer(host: Pick<CoreFoundationHost, "names">, name: string): number {
  const pointer = host.names.get(name);
  if (pointer === undefined) throw new Error(`Unknown host class ${name}`);
  return pointer;
}
