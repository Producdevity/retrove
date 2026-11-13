import type {ExecutionBudget} from "../src/runtime/cpu/execution-budget";
export interface GuestCPU {
  readonly budget: ExecutionBudget;
  set threadPointer(address: number);
  map(address: number, size: number, permissions?: number): void;
  protect(address: number, size: number, permissions: number): void;
  write(address: number, bytes: Uint8Array): void;
  read(address: number, size: number): Uint8Array;
  getReg(index: number): number;
  setReg(index: number, value: number): void;
  run(address: number, options?: { until?: number; count?: number }): {
    reason: "until" | "trap" | "budget";
    pc: number;
  };
  trap(address: number, handler: (cpu: GuestCPU, address: number) => void): () => void;
  saveState(): unknown;
  restoreState(state: unknown): void;
  freeState(state: unknown): void;
  close(): void;
}
export function createCPU(options?: {readonly budget?: ExecutionBudget}): Promise<GuestCPU>;
