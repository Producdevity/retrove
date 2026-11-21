import type {ExecutionBudget} from "../src/runtime/cpu/execution-budget";
import type {TciTierStatistics} from "../src/runtime/cpu/tci/tier";
import type {TierStatistics} from "../src/runtime/cpu/translation/tier-statistics";
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
  /** The own CPU's guest memory is a shared WebAssembly.Memory. */
  readonly sharedMemory?: boolean;
  /** Atomic guest words (see guest-atomics.ts); absent on CPUs that run one thread at a time. */
  compareExchange32?(address: number, expected: number, replacement: number): number;
  add32?(address: number, delta: number): number;
  store32?(address: number, value: number): void;
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
export function createCPU(options?: {readonly budget?: ExecutionBudget; readonly compilationThreshold?: number; readonly translation?: boolean; readonly translationProfile?: string | undefined; readonly workerThreads?: boolean}): Promise<GuestCPU>;
