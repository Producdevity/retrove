import type { GuestCPU } from "../../cpu/cpu";
import type { RemoteThread } from "../../cpu/worker/remote-thread";
import type { GuestLandingPad } from "../../cxx/landing-pad";
import type { Heap } from "../../memory/guest-memory";

/** pthread and Mach return codes the thread imports report. */
export const ThreadError = {
  NoSuchThread: 3,
  Deadlock: 11,
  Busy: 16,
  Invalid: 22,
  Again: 35,
  TimedOut: 60,
} as const;
export const KernReturn = { InvalidArgument: 4, Terminated: 37 } as const;
export const MAIN_THREAD = 1;

/** Polls a blocked guest call: undefined while it still waits, otherwise the value for r0. */
export type WaitPoll = () => unknown;
/** A host result that blocks the calling guest thread until `wait` returns a value. */
export interface ThreadWait {
  readonly wait: WaitPoll;
}
export interface StepExit {
  readonly done: true;
  readonly value: number;
}
export interface StepContinue {
  readonly done?: false;
  readonly pc: number;
  readonly wait?: WaitPoll | undefined;
  readonly budget?: boolean;
  readonly unwind?: GuestLandingPad;
}
/** Where one CPU slice of a guest thread stopped. */
export type StepResult = StepExit | StepContinue;
export type Step = (pc: number) => StepResult | Promise<StepResult>;
/** Runs guest code at `entry` on the current thread's stack. */
export type NestedCall = (entry: number, args: number[]) => Promise<unknown>;

export type ThreadCpu = Pick<
  GuestCPU,
  | "read"
  | "write"
  | "protect"
  | "getReg"
  | "setReg"
  | "saveState"
  | "restoreState"
  | "freeState"
  | "compareExchange32"
  | "store32"
  | "workers"
  | "threadPointer"
>;
export type ThreadHeap = Pick<Heap, "zero" | "alloc" | "free">;

/** The application's main thread: it runs on the CPU the runtime drives. */
export interface GuestThread {
  readonly id: number;
  readonly tls: Map<number, number>;
  readonly stackBottom: number;
  /** pthread_self's word; zero once the thread's memory is freed. */
  pointer: number;
}
/** A thread the guest created; it runs on the cooperative scheduler or an execution worker. */
export interface SpawnedThread extends GuestThread {
  pc: number;
  readonly args: readonly number[];
  stack: number;
  readonly sp: number;
  running: boolean;
  done: boolean;
  detached: boolean;
  joining?: boolean;
  readonly onExit: ((value: number) => unknown) | undefined;
  remote?: RemoteThread | undefined;
  /** CPU registers between the thread's turns. */
  state: unknown;
  wait: WaitPoll | undefined;
  resume: number | undefined;
  value?: number;
}

/** The value a poll produced, as it goes into r0. */
export function registerValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
/** The poll's value when it is ready at once, otherwise the poll as a wait. */
export function asWait<T>(poll: () => T | undefined): T | ThreadWait {
  const value = poll();
  return value === undefined ? { wait: poll } : value;
}
