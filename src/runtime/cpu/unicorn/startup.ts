import type { UnicornHook, UnicornModule } from "./module";
import type { UnicornParts } from "./setup";

/** CPACR access for coprocessors 10 and 11: scalar VFP and Advanced SIMD. */
const CPACR_VFP_NEON = 0xf00000;
const FPEXC_ENABLE = 0x40000000;
/** FPSCR flush-to-zero and default-NaN: Apple's ARMv7 runtime starts in RunFast mode. */
const FPSCR_RUN_FAST = 0x3000000;
const CPSR_USER_MODE = 0x10;

export interface MemoryFault {
  readonly faultAddress: number;
  readonly faultType: unknown;
  readonly faultAccess: string;
  readonly faultSize: unknown;
}

/** Enables VFP and NEON, then switches from Unicorn's reset state to ARM user mode. */
export function startUserMode({ uc, registerTransfer }: UnicornParts): void {
  const cpacr = registerTransfer.read(uc.ARM_REG_C1_C0_2);
  registerTransfer.write(uc.ARM_REG_C1_C0_2, cpacr | CPACR_VFP_NEON);
  registerTransfer.write(uc.ARM_REG_FPEXC, FPEXC_ENABLE);
  const fpscr = registerTransfer.read(uc.ARM_REG_FPSCR);
  registerTransfer.write(uc.ARM_REG_FPSCR, fpscr | FPSCR_RUN_FAST);
  registerTransfer.write(uc.ARM_REG_CPSR, CPSR_USER_MODE);
}

/** Hook types and the callback recording unmapped and protection faults; the hook stops the CPU. */
export function memoryFaultHook(
  uc: UnicornModule,
  record: (fault: MemoryFault) => void,
): { readonly type: number; readonly callback: UnicornHook } {
  const type =
    uc.HOOK_MEM_READ_UNMAPPED |
    uc.HOOK_MEM_WRITE_UNMAPPED |
    uc.HOOK_MEM_FETCH_UNMAPPED |
    uc.HOOK_MEM_READ_PROT |
    uc.HOOK_MEM_WRITE_PROT |
    uc.HOOK_MEM_FETCH_PROT;
  const accessNames = new Map<unknown, string>([
    [uc.MEM_READ_UNMAPPED, "unmapped read"],
    [uc.MEM_WRITE_UNMAPPED, "unmapped write"],
    [uc.MEM_FETCH_UNMAPPED, "unmapped instruction fetch"],
    [uc.MEM_READ_PROT, "protected read"],
    [uc.MEM_WRITE_PROT, "protected write"],
    [uc.MEM_FETCH_PROT, "protected instruction fetch"],
  ]);
  const callback: UnicornHook = (_, access, address, size) => {
    record({
      faultAddress: Number(address),
      faultType: access,
      faultAccess: accessNames.get(access) || String(access),
      faultSize: size,
    });
    return false;
  };
  return { type, callback };
}
