import { read32, readString, write32 } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { IOSPlatform } from "../platform";
import { Errno } from "./bsd-errno";
import { PAGE_BYTES, PHYSICAL_MEMORY, type Failure, type MappedMemory } from "./darwin-memory";
import type { GuestArguments } from "../objc/host";
import type { GuestHeap, GuestImport } from "./guest-imports";
import { ResourceLimits, rlimitImports } from "./rlimits";
import { sysctlImports } from "./sysctl";
import { unameImports } from "./uname";

const HOST = 1;
export const TASK = 2;
const KERN_INVALID_ARGUMENT = 4;
const KERN_NOT_SUPPORTED = 46;
const HOST_VM_INFO = 2;
const HOST_VM_INFO_COUNT = 15;
const TASK_BASIC_INFO = 4;
const TASK_BASIC_INFO_COUNT = 8;
const THREAD_TIME_CONSTRAINT_POLICY = 2;
const THREAD_TIME_CONSTRAINT_COUNT = 4;
const VmInfo = { FreePages: 0, ActivePages: 1 } as const;
const TaskInfo = { VirtualSize: 1, ResidentSize: 2, Policy: 7 } as const;
const PolicySet = { Thread: 0, Flavor: 1, Policy: 2, Count: 3 } as const;
const HostStatistics = { Host: 0, Flavor: 1, Buffer: 2, Count: 3 } as const;
const Sc = {
  ArgMax: 1,
  ChildMax: 2,
  ClockTicks: 3,
  GroupsMax: 4,
  OpenMax: 5,
  PageSize: 29,
  ProcessorsConfigured: 57,
  ProcessorsOnline: 58,
} as const;
const ARG_MAX = 262144;
const CLOCK_TICKS = 100;
const NGROUPS_MAX = 16;
const ENVIRONMENT = new Map([
  ["HOME", "/"],
  ["TMPDIR", "/tmp/"],
  ["LANG", "C"],
]);
const encoder = new TextEncoder();

type StatisticsValues = readonly (readonly [number, number])[];

function machStatistics(
  cpu: MappedMemory,
  a: GuestArguments,
  port: number,
  flavor: number,
  count: number,
  values: StatisticsValues,
): number {
  if (
    a(HostStatistics.Host) !== port ||
    a(HostStatistics.Flavor) !== flavor ||
    !a(HostStatistics.Buffer) ||
    !a(HostStatistics.Count) ||
    read32(cpu, a(HostStatistics.Count)) < count
  )
    return KERN_INVALID_ARGUMENT;
  const buffer = new Uint8Array(count * WORD_BYTES),
    view = new DataView(buffer.buffer);
  for (const [index, value] of values) view.setUint32(index * WORD_BYTES, value, true);
  cpu.write(a(HostStatistics.Buffer), buffer);
  write32(cpu, a(HostStatistics.Count), count);
  return 0;
}

function machImports(cpu: MappedMemory): Record<string, GuestImport> {
  return {
    _mach_host_self: () => HOST,
    _host_page_size: (a) => {
      if (a(0) !== HOST || !a(1)) return KERN_INVALID_ARGUMENT;
      write32(cpu, a(1), PAGE_BYTES);
      return 0;
    },
    _host_statistics: (a) => {
      const pages = Math.ceil(cpu.mappedBytes / PAGE_BYTES);
      return machStatistics(cpu, a, HOST, HOST_VM_INFO, HOST_VM_INFO_COUNT, [
        [VmInfo.FreePages, Math.max(0, PHYSICAL_MEMORY / PAGE_BYTES - pages)],
        [VmInfo.ActivePages, pages],
      ]);
    },
    _task_info: (a) =>
      machStatistics(cpu, a, TASK, TASK_BASIC_INFO, TASK_BASIC_INFO_COUNT, [
        [TaskInfo.VirtualSize, cpu.mappedBytes],
        [TaskInfo.ResidentSize, cpu.mappedBytes],
        [TaskInfo.Policy, 1],
      ]),
    _thread_policy_set: (a) =>
      !a(PolicySet.Thread) ||
      a(PolicySet.Flavor) !== THREAD_TIME_CONSTRAINT_POLICY ||
      !a(PolicySet.Policy) ||
      a(PolicySet.Count) !== THREAD_TIME_CONSTRAINT_COUNT
        ? KERN_INVALID_ARGUMENT
        : KERN_NOT_SUPPORTED,
  };
}

export function darwinSystem(
  cpu: MappedMemory,
  heap: GuestHeap,
  errno: number,
): Record<string, GuestImport> {
  const env = new Map<string, number>();
  const limits = new ResourceLimits();
  const failure: Failure = (code) => {
    write32(cpu, errno, code);
    return -1;
  };
  return {
    ...unameImports({ write: (p, b) => cpu.write(p, b), fail: failure }),
    _sysconf: (a) => {
      switch (a(0)) {
        case Sc.ArgMax:
          return ARG_MAX;
        case Sc.ChildMax:
          return 0; // No child process facility.
        case Sc.ClockTicks:
          return CLOCK_TICKS;
        case Sc.GroupsMax:
          return NGROUPS_MAX;
        case Sc.OpenMax:
          return limits.openFiles();
        case Sc.PageSize:
          return PAGE_BYTES;
        case Sc.ProcessorsConfigured:
        case Sc.ProcessorsOnline:
          return 1;
        default:
          return failure(Errno.Invalid);
      }
    },
    ...sysctlImports(cpu, failure),
    ...machImports(cpu),
    ...rlimitImports(cpu, limits, failure),
    _getdtablesize: () => limits.openFiles(),
    _getenv: (a) => {
      const key = readString(cpu, a(0));
      const value = ENVIRONMENT.get(key);
      if (value === undefined) return 0;
      let address = env.get(key);
      if (address === undefined) {
        address = heap.string(value);
        env.set(key, address);
      }
      return address;
    },
    _gethostname: (a) => {
      const bytes = encoder.encode(IOSPlatform.NodeName + "\0");
      if (!a(0)) return failure(Errno.BadAddress);
      cpu.write(a(0), bytes.subarray(0, a(1)));
      return a(1) < bytes.length ? failure(Errno.NameTooLong) : 0;
    },
  };
}
