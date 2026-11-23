import { read32, write32, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { Errno } from "./bsd-errno";
import type { Failure } from "./darwin-memory";
import type { GuestImport } from "./guest-imports";

const RLIMIT_MASK = 0xfff;
const LOW_WORD_MASK = 0xffff_ffffn;
const WORD_BITS = 32n;
export const RLIMIT_STACK = 3;
export const RLIMIT_NOFILE = 8;
const STACK_LIMIT = 0x40_0000n;
const OPEN_FILES_SOFT = 256n;
const OPEN_FILES_HARD = 10240n;
const Rlimit = { Resource: 0, Pointer: 1 } as const;
const HARD_OFFSET = 8;

type Limit = readonly [bigint, bigint];

export class ResourceLimits {
  private readonly limits = new Map<number, Limit>([
    [RLIMIT_STACK, [STACK_LIMIT, STACK_LIMIT]],
    [RLIMIT_NOFILE, [OPEN_FILES_SOFT, OPEN_FILES_HARD]],
  ]);
  openFiles(): number {
    return Number(this.limits.get(RLIMIT_NOFILE)?.[0]);
  }
  get(resource: number): Limit | undefined {
    return this.limits.get(resource);
  }
  set(resource: number, limit: Limit): void {
    this.limits.set(resource, limit);
  }
}

export function rlimitImports(
  cpu: GuestMemory,
  limits: ResourceLimits,
  failure: Failure,
): Record<"_getrlimit" | "_setrlimit", GuestImport> {
  const read64 = (address: number): bigint =>
    BigInt(read32(cpu, address)) | (BigInt(read32(cpu, address + WORD_BYTES)) << WORD_BITS);
  function write64(address: number, value: bigint): void {
    write32(cpu, address, Number(value & LOW_WORD_MASK));
    write32(cpu, address + WORD_BYTES, Number(value >> WORD_BITS));
  }
  return {
    _getrlimit: (a) => {
      const limit = limits.get(a(Rlimit.Resource) & RLIMIT_MASK);
      if (!a(Rlimit.Pointer)) return failure(Errno.BadAddress);
      if (!limit) return failure(Errno.Invalid);
      write64(a(Rlimit.Pointer), limit[0]);
      write64(a(Rlimit.Pointer) + HARD_OFFSET, limit[1]);
      return 0;
    },
    _setrlimit: (a) => {
      const key = a(Rlimit.Resource) & RLIMIT_MASK,
        current = limits.get(key);
      if (!a(Rlimit.Pointer)) return failure(Errno.BadAddress);
      if (!current) return failure(Errno.Invalid);
      const soft = read64(a(Rlimit.Pointer)),
        hard = read64(a(Rlimit.Pointer) + HARD_OFFSET);
      if (soft > hard) return failure(Errno.Invalid);
      if (hard > current[1]) return failure(Errno.NotPermitted);
      if (key === RLIMIT_STACK && soft !== current[0]) return failure(Errno.NotSupported);
      limits.set(key, [soft, hard]);
      return 0;
    },
  };
}
