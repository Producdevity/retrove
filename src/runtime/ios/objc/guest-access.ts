import { read32, readCStringBytes, readString, write32 } from "../../memory/guest-memory";
import type { ObjcGuest } from "./runtime-types";

/** Word, byte and C string access to guest memory, and zeroed runtime allocations. */
export interface GuestAccess {
  readonly read: (address: number) => number;
  readonly write: (address: number, value: number) => void;
  readonly zero: (size: number) => number;
  readonly cString: (address: number) => string;
  readonly cStringBytes: (address: number) => Uint8Array;
  readonly bytes: (address: number, length: number) => Uint8Array;
  readonly writeBytes: (address: number, bytes: Uint8Array) => void;
}
export function guestAccess({ cpu, heap }: Pick<ObjcGuest, "cpu" | "heap">): GuestAccess {
  return {
    read: (address) => read32(cpu, address),
    write: (address, value) => write32(cpu, address, value),
    zero: (size) => {
      const address = heap.zero(size);
      if (!address) throw new Error("Objective-C guest heap exhausted");
      return address;
    },
    cString: (address) => readString(cpu, address),
    cStringBytes: (address) => readCStringBytes(cpu, address),
    bytes: (address, length) => cpu.read(address, length),
    writeBytes: (address, bytes) => cpu.write(address, bytes),
  };
}
/** Stands in for the argument accessor of host methods the runtime calls without arguments. */
export const withoutArguments = (): number => {
  throw new TypeError("Host method called without guest arguments");
};
/** A structure destination for structure methods a caller invokes without one. */
export const MISSING_DESTINATION = Number.NaN;
