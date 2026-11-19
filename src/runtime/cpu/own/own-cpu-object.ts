import type { ExecutionBudget } from "../execution-budget";
import { OwnCpu, type OwnCpuOptions, type TrapHandler } from "./own-cpu";
import type { SavedState } from "./guest-state";

type Saved = { readonly translated: SavedState; readonly threadPointer: number };

/**
 * The own CPU as the plain object the runtime expects: it passes methods around detached from
 * the object, which class methods with private state do not survive.
 */
export function ownCpuObject(budget: ExecutionBudget, options: OwnCpuOptions) {
  const own = new OwnCpu(budget, options);
  const cpu = {
    method: "translated",
    get budget() {
      return own.budget;
    },
    get compiler() {
      return own.compiler;
    },
    get translation() {
      return own.translation;
    },
    get mappedBytes() {
      return own.mappedBytes;
    },
    get executedMilliseconds() {
      return own.executedMilliseconds;
    },
    get interpretedMilliseconds() {
      return own.interpretedMilliseconds;
    },
    set threadPointer(address: number) {
      own.threadPointer = address;
    },
    get cpsr() {
      return own.cpsr;
    },
    set cpsr(value: number) {
      own.cpsr = value;
    },
    get nextPC() {
      return own.nextPC;
    },
    map: (address: number, size: number, permissions?: number) =>
      own.map(address, size, permissions),
    unmap: (address: number, size: number) => own.unmap(address, size),
    protect: (address: number, size: number, permissions: number) =>
      own.protect(address, size, permissions),
    write: (address: number, bytes: Uint8Array | ArrayLike<number>) => own.write(address, bytes),
    read: (address: number, length: number) => own.read(address, length),
    read32: (address: number) => own.read32(address),
    get sharedMemory() {
      return own.sharedMemory;
    },
    compareExchange32: (address: number, expected: number, replacement: number) =>
      own.atomics.compareExchange32(address, expected, replacement),
    add32: (address: number, delta: number) => own.atomics.add32(address, delta),
    store32: (address: number, value: number) => own.atomics.store32(address, value),
    getReg: (register: number) => own.getReg(register),
    setReg: (register: number, value: number) => own.setReg(register, value),
    branch: (target: number) => own.branch(target),
    trap: (address: number, fn: TrapHandler) => own.trap(address, fn),
    trapRange: (first: number, last: number, fn: TrapHandler) => own.trapRange(first, last, fn),
    run: (startPC?: number, limits?: { until?: number; count?: number }) =>
      own.run(startPC, limits),
    saveState: () => own.saveState(),
    restoreState: (saved: Saved) => own.restoreState(saved),
    freeState: () => own.freeState(),
    close: () => own.close(),
  };
  own.facade = cpu;
  return cpu;
}
