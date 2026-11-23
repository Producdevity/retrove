import { read32, readString, write32 } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { IOSPlatform } from "../platform";
import { Errno } from "./bsd-errno";
import { PAGE_BYTES, PHYSICAL_MEMORY, type Failure, type MappedMemory } from "./darwin-memory";
import type { GuestImport } from "./guest-imports";

const CPU_COUNT = 1;
const QUAD_BYTES = 8;
const MIB_DEPTH = 2;
const CTL_HW = 6;
const CPU_NAMES = ["hw.ncpu", "hw.physicalcpu", "hw.logicalcpu", "hw.activecpu"];
const HwMib = {
  Machine: 1,
  Cpus: 3,
  PhysicalMemory: 5,
  UserMemory: 6,
  PageSize: 7,
  MemorySize: 24,
};
const NUMERIC_MIB = new Map([
  [HwMib.Machine, "hw.machine"],
  [HwMib.Cpus, "hw.ncpu"],
  [HwMib.PhysicalMemory, "hw.physmem"],
  [HwMib.UserMemory, "hw.usermem"],
  [HwMib.PageSize, "hw.pagesize"],
  [HwMib.MemorySize, "hw.memsize"],
]);
const Sysctl = { Name: 0, Output: 1, Count: 2, Replacement: 3, ReplacementSize: 4 } as const;
const Mib = { Pointer: 0, Length: 1, Output: 2, Count: 3, Replacement: 4, ReplacementSize: 5 };
const encoder = new TextEncoder();

function valueBytes(cpu: MappedMemory, name: string | undefined): Uint8Array | undefined {
  if (name === "hw.machine") return encoder.encode(IOSPlatform.Model + "\0");
  let value: number;
  if (name !== undefined && CPU_NAMES.includes(name)) value = CPU_COUNT;
  else if (name === "hw.pagesize") value = PAGE_BYTES;
  else if (name === "hw.memsize" || name === "hw.physmem") value = PHYSICAL_MEMORY;
  else if (name === "hw.usermem") value = Math.max(0, PHYSICAL_MEMORY - cpu.mappedBytes);
  else return undefined;
  const bytes = new Uint8Array(name === "hw.memsize" ? QUAD_BYTES : WORD_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function sysctlImports(
  cpu: MappedMemory,
  failure: Failure,
): Record<"_sysctlbyname" | "_sysctl", GuestImport> {
  function control(
    name: string | undefined,
    output: number,
    count: number,
    replacement: number,
    replacementSize: number,
  ): number {
    if (replacement || replacementSize) return failure(Errno.NotPermitted);
    const bytes = valueBytes(cpu, name);
    if (!bytes) return failure(Errno.NoEntry);
    if (!count) return output ? failure(Errno.BadAddress) : 0;
    const size = output ? Math.min(bytes.length, read32(cpu, count)) : bytes.length;
    if (output && size) cpu.write(output, bytes.subarray(0, size));
    write32(cpu, count, size);
    return size === bytes.length ? 0 : failure(Errno.NoMemory);
  }
  return {
    _sysctlbyname: (a) =>
      a(Sysctl.Name)
        ? control(
            readString(cpu, a(Sysctl.Name)),
            a(Sysctl.Output),
            a(Sysctl.Count),
            a(Sysctl.Replacement),
            a(Sysctl.ReplacementSize),
          )
        : failure(Errno.BadAddress),
    _sysctl: (a) => {
      if (!a(Mib.Pointer)) return failure(Errno.BadAddress);
      if (a(Mib.Length) !== MIB_DEPTH || read32(cpu, a(Mib.Pointer)) !== CTL_HW)
        return failure(Errno.NoEntry);
      return control(
        NUMERIC_MIB.get(read32(cpu, a(Mib.Pointer) + WORD_BYTES)),
        a(Mib.Output),
        a(Mib.Count),
        a(Mib.Replacement),
        a(Mib.ReplacementSize),
      );
    },
  };
}
