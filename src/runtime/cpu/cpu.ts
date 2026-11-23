import { ExecutionBudget } from "./execution-budget";
import type { TrapHandler } from "./own/own-cpu";
import { ownCpuObject } from "./own/own-cpu-object";
import { TciTierLimit, type TciTierStatistics } from "./tci/tier";
import { loadTranslationProfile, saveTranslationProfile } from "./translation/profile-storage";
import { translationCacheEnabled, translationEnabled } from "./translation/settings";
import type { TierStatistics } from "./translation/tier-statistics";
import { loadUnicorn } from "./unicorn/module";
import { openUnicorn } from "./unicorn/setup";
import { UnicornCpu } from "./unicorn/unicorn-cpu";
import { unicornCpuObject } from "./unicorn/unicorn-cpu-object";
import { deviceBudget } from "../memory/device-budget";

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
  run(
    address: number,
    options?: { until?: number; count?: number },
  ): {
    reason: "until" | "trap" | "budget";
    pc: number;
  };
  /** Handlers receive the CPU object the runtime holds. */
  trap(address: number, handler: TrapHandler): () => void;
  saveState(): unknown;
  restoreState(state: unknown): void;
  freeState(state: unknown): void;
  close(): void;
}
export type CpuKind = "unicorn" | "own";
export interface CpuOptions {
  readonly budget?: ExecutionBudget;
  readonly compilationThreshold?: number;
  readonly translation?: boolean;
  readonly translationProfile?: string | undefined;
  readonly cpu?: CpuKind;
}

export async function createCPU({
  budget = ExecutionBudget.Instructions,
  compilationThreshold = TciTierLimit.Threshold,
  translation = translationEnabled() && deviceBudget().translation,
  translationProfile,
  cpu: kind = "unicorn",
}: CpuOptions = {}): Promise<GuestCPU> {
  if (!Object.values(ExecutionBudget).includes(budget))
    throw new TypeError("Unknown CPU execution budget.");
  // The own CPU needs the translated tier's arena; without it Unicorn runs the guest.
  if (kind === "own" && translation) {
    const key = translationCacheEnabled() ? translationProfile : undefined;
    return ownCpuObject(budget, {
      profile: key ? await loadTranslationProfile(key) : undefined,
      cache: key,
      codeBudget: deviceBudget().codeBytes,
      onProfile: key ? (p) => saveTranslationProfile(key, p) : undefined,
    });
  }
  const profileKey = translation && translationCacheEnabled() ? translationProfile : undefined;
  const profile = profileKey ? await loadTranslationProfile(profileKey) : undefined;
  const parts = openUnicorn(await loadUnicorn(), {
    budget,
    compilationThreshold,
    translation,
    profile,
    profileKey,
  });
  return unicornCpuObject(new UnicornCpu(budget, parts));
}
