import type { Heap, GuestMemory } from "../../../memory/guest-memory";
import type { AtomicGuestMemory } from "../../../memory/guest-atomics";
import type { GuestArguments } from "../../objc/host";
import type { BacktraceCpu } from "../backtrace";
import type { MappedMemory } from "../darwin-memory";
import type { ZlibCpu } from "../guest-zlib";
import type { GuestJump, HostWait } from "../guest-imports";
import type { VirtualMemoryCpu } from "../vm";

export interface SystemCpu
  extends VirtualMemoryCpu, BacktraceCpu, ZlibCpu, MappedMemory, AtomicGuestMemory {}
export interface HostExit {
  exit: number;
}
export type SystemValue = number | bigint | HostWait | GuestJump | HostExit | undefined | void;
export type SystemImport = (a: GuestArguments) => SystemValue | Promise<SystemValue>;
export type CallGuest = (target: number, args: number[]) => Promise<number>;
export interface Finalizer {
  readonly pc: number;
  readonly arg: number;
  readonly image: number;
}
export interface MemoryServices {
  readonly cpu: GuestMemory;
  readonly heap: Heap;
  readonly errno: number;
}
