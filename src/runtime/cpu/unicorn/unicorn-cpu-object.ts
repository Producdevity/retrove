import type { TrapHandler } from "../own/own-cpu";
import type { RunLimits, UnicornCpu, UnicornState } from "./unicorn-cpu";

/**
 * The Unicorn CPU as the plain object the runtime expects: it passes methods around detached from
 * the object, which class methods with private state do not survive.
 */
export function unicornCpuObject(unicorn: UnicornCpu) {
  const memory = unicorn.memory;
  const cpu = {
    get budget() {
      return unicorn.budget;
    },
    get compiler() {
      return unicorn.compiler;
    },
    get translation() {
      return unicorn.translation;
    },
    get mappedBytes() {
      return memory.mappedBytes;
    },
    get executedMilliseconds() {
      return unicorn.executedMilliseconds;
    },
    /** Part of executedMilliseconds spent in Unicorn rather than translated code. */
    get interpretedMilliseconds() {
      return unicorn.interpretedMilliseconds;
    },
    set threadPointer(address: number) {
      unicorn.threadPointer = address;
    },
    map: (address: number, size: number, permissions?: number) =>
      memory.map(address, size, permissions),
    unmap: (address: number, size: number) => memory.unmap(address, size),
    protect: (address: number, size: number, permissions: number) =>
      memory.protect(address, size, permissions),
    write: (address: number, bytes: Uint8Array | ArrayLike<number>) => memory.write(address, bytes),
    read: (address: number, length: number) => memory.read(address, length),
    read32: (address: number) => memory.read32(address),
    getReg: (register: number) => unicorn.getReg(register),
    setReg: (register: number, value: number) => unicorn.setReg(register, value),
    get cpsr() {
      return unicorn.cpsr;
    },
    set cpsr(value: number) {
      unicorn.cpsr = value;
    },
    get nextPC() {
      return unicorn.nextPC;
    },
    branch: (target: number) => unicorn.branch(target),
    trap: (address: number, fn: TrapHandler) => unicorn.trap(address, fn),
    trapRange: (first: number, last: number, fn: TrapHandler) => unicorn.trapRange(first, last, fn),
    run: (startPC?: number, limits?: RunLimits) => unicorn.run(startPC, limits),
    saveState: () => unicorn.saveState(),
    restoreState: (saved: UnicornState) => unicorn.restoreState(saved),
    freeState: (saved: UnicornState) => unicorn.freeState(saved),
    close: () => unicorn.close(),
  };
  unicorn.facade = cpu;
  return cpu;
}
