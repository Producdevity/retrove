// The guest has no routed BSD network interface. Return the corresponding Darwin
// reachability flags and DNS error; a browser's own network remains independent.
import { readString, type GuestMemory } from "../../memory/guest-memory";
import { Errno } from "../libc/bsd-errno";
import type { GuestHeap, GuestImport } from "../libc/guest-imports";
import type { FoundationHost, GuestArguments } from "../objc/host";

const LOOPBACK_V4 = /^127\.\d+\.\d+\.\d+$/;
const REACHABLE_LOCAL_DIRECT = 0x30002;
const AF_INET = 2;
const AF_INET6 = 30;
const SOCKADDR_FAMILY = 1;
const SOCKADDR_V4_ADDRESS = 4;
const SOCKADDR_V6_ADDRESS = 8;
const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const SOCKADDR_V4_BYTES = 16;
const SOCKADDR_V6_BYTES = 28;
const V6_LOOPBACK_BYTE = 15;
const V6_LOOPBACK_OFFSET = 23;
const LOOPBACK_FIRST_OCTET = 127;
const LOOPBACK_ADDRESS = [LOOPBACK_FIRST_OCTET, 0, 0, 1];
const FAMILY_PROBE_BYTES = 2;
const POSIX_ERROR_DOMAIN = 1;
const Argument = { First: 0, Second: 1, Third: 2 } as const;
const Context = { Version: 0, Info: 4, Retain: 8, Release: 12 } as const;
const ErrorField = { Domain: 0, Code: 4 } as const;

export interface ReachabilityHost {
  readonly cpu: GuestMemory;
  readonly heap: GuestHeap;
  readonly names: ReadonlyMap<string, number>;
  readonly hostClass: FoundationHost["hostClass"];
  readonly method: FoundationHost["method"];
  readonly alloc: FoundationHost["alloc"];
  readonly destroy: FoundationHost["destroy"];
  readonly text: FoundationHost["text"];
  readonly read: (address: number) => number;
  readonly write: (address: number, value: number) => void;
  readonly callGuest: (fn: number, args: number[]) => Promise<number>;
  readonly array: (values: number[]) => number;
  readonly dataFrom: (address: number, length: number) => number;
  readonly release: (pointer: number) => Promise<void>;
}

interface Monitor {
  readonly target: string;
  readonly active: Set<string>;
  callback?: number;
  info?: number;
  release?: number;
}
interface HostRecord {
  readonly name: string;
  resolved: boolean;
  addressList?: number;
}

const isLoopback = (name: string): boolean =>
  name === "localhost" || name === "::1" || name === "[::1]" || LOOPBACK_V4.test(name);

function classOf(names: ReadonlyMap<string, number>, name: string): number {
  const pointer = names.get(name);
  if (pointer === undefined) throw new Error(`Missing host class ${name}`);
  return pointer;
}

function loopbackSockaddr(name: string): Uint8Array {
  const v6 = name.includes(":");
  const bytes = new Uint8Array(v6 ? SOCKADDR_V6_BYTES : SOCKADDR_V4_BYTES);
  bytes[0] = bytes.length;
  bytes[SOCKADDR_FAMILY] = v6 ? AF_INET6 : AF_INET;
  if (v6) bytes[V6_LOOPBACK_OFFSET] = 1;
  else
    bytes.set(
      name === "localhost" ? LOOPBACK_ADDRESS : name.split(".").map(Number),
      SOCKADDR_V4_ADDRESS,
    );
  return bytes;
}

function reachabilityTarget(cpu: GuestMemory, address: number): string | undefined {
  const family = cpu.read(address, FAMILY_PROBE_BYTES)[SOCKADDR_FAMILY];
  if (family === AF_INET)
    return Array.from(cpu.read(address + SOCKADDR_V4_ADDRESS, IPV4_BYTES)).join(".");
  if (family === AF_INET6) {
    const ip = cpu.read(address + SOCKADDR_V6_ADDRESS, IPV6_BYTES);
    return ip[V6_LOOPBACK_BYTE] === 1 && ip.subarray(0, V6_LOOPBACK_BYTE).every((b) => !b)
      ? "::1"
      : "";
  }
  return undefined;
}

function reachabilityFunctions(host: ReachabilityHost): Record<string, GuestImport> {
  const { cpu, read, write, callGuest } = host;
  const monitors = new Map<number, Monitor>();
  const create = (target: string): number => {
    const pointer = host.alloc(classOf(host.names, "SCNetworkReachability"));
    monitors.set(pointer, { target, active: new Set() });
    return pointer;
  };
  host.method("SCNetworkReachability", false, "dealloc", async (pointer) => {
    const value = monitors.get(pointer);
    monitors.delete(pointer);
    if (value?.release && value.info) await callGuest(value.release, [value.info]);
    host.destroy(pointer);
  });
  const key = (a: GuestArguments): string => a(Argument.Second) + "/" + a(Argument.Third);
  return {
    _SCNetworkReachabilityCreateWithAddress: (a) => {
      if (!a(Argument.Second)) return 0;
      const target = reachabilityTarget(cpu, a(Argument.Second));
      return target === undefined ? 0 : create(target);
    },
    _SCNetworkReachabilityCreateWithName: (a) =>
      a(Argument.Second) ? create(readString(cpu, a(Argument.Second))) : 0,
    _SCNetworkReachabilityGetFlags: (a) => {
      const monitor = monitors.get(a(Argument.First));
      if (!a(Argument.Second) || !monitor) return 0;
      write(a(Argument.Second), isLoopback(monitor.target) ? REACHABLE_LOCAL_DIRECT : 0);
      return 1;
    },
    _SCNetworkReachabilitySetCallback: async (a) => {
      const record = monitors.get(a(Argument.First)),
        callback = a(Argument.Second),
        context = a(Argument.Third);
      if (!record || (context && read(context + Context.Version) !== 0)) return 0;
      const info = context ? read(context + Context.Info) : 0,
        retainFn = context ? read(context + Context.Retain) : 0,
        releaseFn = context ? read(context + Context.Release) : 0;
      const newInfo = info && retainFn ? await callGuest(retainFn, [info]) : info;
      if (record.info && record.release) await callGuest(record.release, [record.info]);
      Object.assign(record, { callback, info: newInfo, release: releaseFn });
      return 1;
    },
    _SCNetworkReachabilityScheduleWithRunLoop: (a) => {
      const record = monitors.get(a(Argument.First));
      if (!record || !a(Argument.Second) || !a(Argument.Third)) return 0;
      record.active.add(key(a));
      return 1;
    },
    _SCNetworkReachabilityUnscheduleFromRunLoop: (a) =>
      Number(monitors.get(a(Argument.First))?.active.delete(key(a)) ?? false),
  };
}

function resolveLoopback(host: ReachabilityHost, record: HostRecord): void {
  if (record.addressList) return;
  const bytes = loopbackSockaddr(record.name);
  const buffer = host.heap.zero(bytes.length);
  try {
    host.cpu.write(buffer, bytes);
    const value = host.dataFrom(buffer, bytes.length);
    record.addressList = host.array([value]);
    void host.release(value);
  } finally {
    host.heap.free(buffer);
  }
}

function hostFunctions(host: ReachabilityHost): Record<string, GuestImport> {
  const { cpu, write } = host;
  const hosts = new Map<number, HostRecord>();
  host.method("CFHost", false, "dealloc", async (pointer) => {
    const state = hosts.get(pointer);
    hosts.delete(pointer);
    if (state?.addressList) await host.release(state.addressList);
    host.destroy(pointer);
  });
  return {
    _CFHostCreateWithName: (a) => {
      if (!a(Argument.Second)) return 0;
      const pointer = host.alloc(classOf(host.names, "CFHost"));
      hosts.set(pointer, { name: host.text(a(Argument.Second)), resolved: false });
      return pointer;
    },
    _CFHostStartInfoResolution: (a) => {
      const record = hosts.get(a(Argument.First)),
        error = a(Argument.Third);
      if (!record) return 0;
      if (a(Argument.Second) === 0 && isLoopback(record.name)) {
        resolveLoopback(host, record);
        record.resolved = true;
        if (error) {
          write(error + ErrorField.Domain, 0);
          write(error + ErrorField.Code, 0);
        }
        return 1;
      }
      if (error) {
        write(error + ErrorField.Domain, POSIX_ERROR_DOMAIN);
        write(error + ErrorField.Code, Errno.HostUnreachable);
      }
      record.resolved = false;
      return 0;
    },
    _CFHostGetAddressing: (a) => {
      const record = hosts.get(a(Argument.First));
      if (a(Argument.Second))
        cpu.write(a(Argument.Second), new Uint8Array([Number(Boolean(record?.resolved))]));
      return record?.resolved ? record.addressList : 0;
    },
  };
}

export function cfNetwork(host: ReachabilityHost): Record<string, GuestImport> {
  host.hostClass("SCNetworkReachability", "NSObject");
  host.hostClass("CFHost", "NSObject");
  return { ...reachabilityFunctions(host), ...hostFunctions(host) };
}
