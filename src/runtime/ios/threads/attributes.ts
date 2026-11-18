const INVALID_ARGUMENT = 22;
const PAGE_BYTES = 4096;
const MINIMUM_STACK_BYTES = 8192;
const MAXIMUM_STACK_BYTES = 33_554_432;
const DEFAULT_STACK_BYTES = 524_288;
export const DEFAULT_PRIORITY = 31;
export const ThreadPolicy = { Other: 1, RoundRobin: 2, Fifo: 4 } as const;
export const ThreadDetach = { Joinable: 1, Detached: 2 } as const;
export interface ThreadOptions {
  readonly size: number;
  readonly detached: boolean;
  readonly policy: number;
  readonly priority: number;
}
export class ThreadAttributes {
  private readonly values = new Map<number, ThreadOptions>();
  initialize(address: number): number {
    this.values.set(address, {
      size: DEFAULT_STACK_BYTES,
      detached: false,
      policy: ThreadPolicy.Other,
      priority: DEFAULT_PRIORITY,
    });
    return 0;
  }
  destroy(address: number): number {
    return this.values.delete(address) ? 0 : INVALID_ARGUMENT;
  }
  has(address: number): boolean {
    return this.values.has(address);
  }
  get(address: number): Readonly<ThreadOptions> | undefined {
    return this.values.get(address);
  }
  private update(address: number, change: Partial<ThreadOptions>, valid = true): number {
    const current = this.values.get(address);
    if (!current || !valid) return INVALID_ARGUMENT;
    this.values.set(address, { ...current, ...change });
    return 0;
  }
  stackSize(address: number, bytes: number): number {
    return this.update(
      address,
      { size: Math.ceil(bytes / PAGE_BYTES) * PAGE_BYTES },
      Number.isSafeInteger(bytes) && bytes >= MINIMUM_STACK_BYTES && bytes <= MAXIMUM_STACK_BYTES,
    );
  }
  detach(address: number, mode: number): number {
    return this.update(
      address,
      { detached: mode === ThreadDetach.Detached },
      mode === ThreadDetach.Joinable || mode === ThreadDetach.Detached,
    );
  }
  policy(address: number, policy: number): number {
    return this.update(
      address,
      { policy },
      Object.values(ThreadPolicy).some((value) => value === policy),
    );
  }
  priority(address: number, priority: number): number {
    // Darwin stores sched_priority in the attribute without a range check.
    return this.update(address, { priority });
  }
}
