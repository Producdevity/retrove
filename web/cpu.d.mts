import type {ExecutionBudget} from "../src/runtime/cpu/execution-budget";
import type {TciTierStatistics} from "../src/runtime/cpu/tci/tier";
import type {TierStatistics} from "../src/runtime/cpu/translation/tier";
export interface GuestCPU {
  readonly compiler: TciTierStatistics | undefined;
  readonly translation: TierStatistics | undefined;
  readonly budget: ExecutionBudget;
  set threadPointer(address: number);
  map(address: number, size: number, permissions?: number): void;
  protect(address: number, size: number, permissions: number): void;
  write(address: number, bytes: Uint8Array): void;
  read(address: number, size: number): Uint8Array;
  read32(address: number): number;
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
export function createCPU(options?: {readonly budget?: ExecutionBudget; readonly compilationThreshold?: number; readonly translation?: boolean}): Promise<GuestCPU>;
