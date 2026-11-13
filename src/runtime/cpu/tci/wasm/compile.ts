import type { TciBlock } from "../model";
import { tciModule } from "./module";
export interface TciHost {
  readonly memory: WebAssembly.Memory;
  readonly table: WebAssembly.Table;
  readonly pc: number;
  readonly load: (environment: number, address: number, mode: number, next: number) => bigint;
  readonly store: (
    environment: number,
    address: number,
    value: bigint,
    mode: number,
    next: number,
  ) => void;
}
export type CompiledTciBlock = (registers: number, next: number, result: number) => number;
function procedure(value: unknown): value is CompiledTciBlock {
  return typeof value === "function";
}
export function compileTci(block: TciBlock, host: TciHost): CompiledTciBlock {
  const module = new WebAssembly.Module(tciModule(block, host.pc));
  const { run } = new WebAssembly.Instance(module, {
    host: {
      memory: host.memory,
      table: host.table,
      load: host.load,
      store: host.store,
    },
  }).exports;
  if (!procedure(run)) throw new Error("Compiled TCI block does not export its entry point.");
  return run;
}
