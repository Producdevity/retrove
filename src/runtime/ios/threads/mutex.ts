export const MutexType = { Normal: 0, ErrorChecking: 1, Recursive: 2 } as const;
export type MutexType = (typeof MutexType)[keyof typeof MutexType];
export const MutexError = {
  Permission: 1,
  Deadlock: 11,
  Busy: 16,
  Invalid: 22,
  Again: 35,
} as const;
export const MutexLayout = {
  Signature: 0,
  Type: 4,
  Owner: 8,
  Depth: 12,
  Bytes: 16,
  Initialized: 0x52544d58,
  MaximumDepth: 0xffffffff,
} as const;
export const StaticMutex = {
  Normal: 0x32aaaba7,
  ErrorChecking: 0x32aaaba1,
  Recursive: 0x32aaaba2,
} as const;
interface MutexMemory {
  read(address: number): number;
  write(address: number, value: number): void;
}
export interface MutexWait {
  wait(): number | undefined;
}
function staticType(signature: number): MutexType | undefined {
  switch (signature) {
    case StaticMutex.Normal:
      return MutexType.Normal;
    case StaticMutex.ErrorChecking:
      return MutexType.ErrorChecking;
    case StaticMutex.Recursive:
      return MutexType.Recursive;
    default:
      return undefined;
  }
}
export class GuestMutexes {
  constructor(private readonly memory: MutexMemory) {}
  initialize(pointer: number, type: number): number {
    if (!Object.values(MutexType).some((value) => value === type)) return MutexError.Invalid;
    this.memory.write(pointer + MutexLayout.Type, type);
    this.memory.write(pointer + MutexLayout.Owner, 0);
    this.memory.write(pointer + MutexLayout.Depth, 0);
    this.memory.write(pointer, MutexLayout.Initialized);
    return 0;
  }
  private ready(pointer: number): boolean {
    const signature = this.memory.read(pointer);
    if (signature === MutexLayout.Initialized) return true;
    const type = staticType(signature);
    return type !== undefined && this.initialize(pointer, type) === 0;
  }
  ownsOnce(pointer: number, thread: number): boolean {
    return (
      this.ready(pointer) &&
      this.memory.read(pointer + MutexLayout.Owner) === thread &&
      this.memory.read(pointer + MutexLayout.Depth) === 1
    );
  }
  take(pointer: number, thread: number): number | undefined {
    if (!this.ready(pointer)) return MutexError.Invalid;
    const owner = this.memory.read(pointer + MutexLayout.Owner);
    const type = this.memory.read(pointer + MutexLayout.Type);
    if (owner && (owner !== thread || type !== MutexType.Recursive)) return undefined;
    const depth = this.memory.read(pointer + MutexLayout.Depth);
    if (depth === MutexLayout.MaximumDepth) return MutexError.Again;
    this.memory.write(pointer + MutexLayout.Owner, thread);
    this.memory.write(pointer + MutexLayout.Depth, depth + 1);
    return 0;
  }
  lock(pointer: number, thread: number, tryOnly: boolean): number | MutexWait {
    if (!this.ready(pointer)) return MutexError.Invalid;
    if (
      !tryOnly &&
      this.memory.read(pointer + MutexLayout.Owner) === thread &&
      this.memory.read(pointer + MutexLayout.Type) === MutexType.ErrorChecking
    )
      return MutexError.Deadlock;
    const result = this.take(pointer, thread);
    if (result !== undefined) return result;
    return tryOnly ? MutexError.Busy : { wait: () => this.take(pointer, thread) };
  }
  unlock(pointer: number, thread: number): number {
    if (!this.ready(pointer)) return MutexError.Invalid;
    if (this.memory.read(pointer + MutexLayout.Owner) !== thread) return MutexError.Permission;
    const depth = this.memory.read(pointer + MutexLayout.Depth) - 1;
    this.memory.write(pointer + MutexLayout.Depth, depth);
    if (!depth) this.memory.write(pointer + MutexLayout.Owner, 0);
    return 0;
  }
  destroy(pointer: number): number {
    if (!this.ready(pointer)) return MutexError.Invalid;
    if (this.memory.read(pointer + MutexLayout.Owner)) return MutexError.Busy;
    this.memory.write(pointer, 0);
    return 0;
  }
}
