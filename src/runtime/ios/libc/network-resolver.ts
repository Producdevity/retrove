import { read32, readString, write32, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { Errno } from "./bsd-errno";
import { UINT32_MAX, type GuestHeap, type GuestImport } from "./guest-imports";
import { AF_INET, ipv4, LOCAL_ADDRESS, SOCKADDR_BYTES, sockaddrBytes } from "./network-addresses";
import { SOCK_DGRAM, SOCK_STREAM } from "./loopback-network";

// Darwin EAI_* codes; only loopback and numeric IPv4 names resolve on the isolated device.
const EAI = { Family: 5, Memory: 6, NoName: 8, Service: 9, SockType: 10 } as const;
const AI_PASSIVE = 1;
const HTTP_PORT = 80;
const HTTPS_PORT = 443;
const SERVICES = new Map([
  ["http", HTTP_PORT],
  ["https", HTTPS_PORT],
]);
const LOCALHOST_NAMES = ["localhost", "localhost.localdomain"];
const MAX_PORT = 65536;
const IPPROTO_TCP = 6;
const IPPROTO_UDP = 17;
const ADDRINFO_BYTES = 48;
const ADDRINFO_ADDRESS = 32;
const Hints = { Flags: 0, Family: 4, SocketType: 8 } as const;
const GetAddrInfo = { Node: 0, Service: 1, Hints: 2, Result: 3 } as const;
const IFADDRS_BYTES = 64;
const IFADDRS_NAME = 28;
const IFADDRS_ADDRESS = 32;
const IFADDRS_MASK = 48;
const IFF_UP_LOOPBACK_RUNNING_MULTICAST = 0x8049;
const NETMASK_FIRST_BYTE = 255;
const LOOPBACK_INDEX = 1;
const HOSTENT_BYTES = 296;
const Hostent = {
  Name: 0,
  Aliases: 4,
  AddressType: 8,
  Length: 12,
  AddressList: 16,
  AliasList: 20,
  Addresses: 24,
  Address: 32,
  NameText: 40,
} as const;
const HOSTENT_NAME_LIMIT = 255;
const IPV4_LENGTH = 4;
const NTOA_BYTES = 16;
const BYTE_BITS = 8;
const BYTE_MASK = 255;
const encoder = new TextEncoder();

function servicePort(service: string): number | null {
  if (!service) return 0;
  if (/^\d+$/.test(service)) return Number(service) < MAX_PORT ? Number(service) : null;
  return SERVICES.get(service.toLowerCase()) ?? null;
}

function hostAddress(name: string): number | null {
  return ipv4(name) ?? (LOCALHOST_NAMES.includes(name.toLowerCase()) ? LOCAL_ADDRESS : null);
}

function gaiMessage(code: number): string {
  if (code === EAI.NoName) return "nodename nor servname provided, or not known";
  if (code === EAI.Service) return "servname not supported for ai_socktype";
  return "Unknown error";
}

function addressInfoImports(cpu: GuestMemory, heap: GuestHeap): Record<string, GuestImport> {
  const addressInfos = new Set<number>(),
    gaiMessages = new Map<number, number>();
  function addressInfo(a: (n: number) => number): number {
    const node = a(GetAddrInfo.Node) ? readString(cpu, a(GetAddrInfo.Node)) : "",
      service = a(GetAddrInfo.Service) ? readString(cpu, a(GetAddrInfo.Service)) : "",
      hints = a(GetAddrInfo.Hints);
    const flags = hints ? read32(cpu, hints + Hints.Flags) : 0,
      family = hints ? read32(cpu, hints + Hints.Family) : 0,
      socktype = hints ? read32(cpu, hints + Hints.SocketType) || SOCK_STREAM : SOCK_STREAM;
    if (!node && !service) return EAI.NoName;
    if (family !== 0 && family !== AF_INET) return EAI.Family;
    if (socktype !== SOCK_STREAM && socktype !== SOCK_DGRAM) return EAI.SockType;
    const number = servicePort(service);
    if (number === null) return EAI.Service;
    const ip = node ? hostAddress(node) : flags & AI_PASSIVE ? 0 : LOCAL_ADDRESS;
    if (ip === null) return EAI.NoName;
    const info = heap.zero(ADDRINFO_BYTES);
    if (!info) return EAI.Memory;
    [
      flags,
      AF_INET,
      socktype,
      socktype === SOCK_STREAM ? IPPROTO_TCP : IPPROTO_UDP,
      SOCKADDR_BYTES,
      0,
      info + ADDRINFO_ADDRESS,
      0,
    ].forEach((value, index) => {
      write32(cpu, info + WORD_BYTES * index, value);
    });
    cpu.write(info + ADDRINFO_ADDRESS, sockaddrBytes(ip, number));
    addressInfos.add(info);
    write32(cpu, a(GetAddrInfo.Result), info);
    return 0;
  }
  return {
    _getaddrinfo: addressInfo,
    _freeaddrinfo: (a) => {
      if (addressInfos.delete(a(0))) heap.free(a(0));
    },
    _gai_strerror: (a) => {
      let message = gaiMessages.get(a(0));
      if (message === undefined) {
        const text = gaiMessage(a(0)) + "\0";
        message = heap.zero(text.length);
        cpu.write(message, encoder.encode(text));
        gaiMessages.set(a(0), message);
      }
      return message;
    },
  };
}

function interfaceImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  fail: (errno: number) => number,
): Record<string, GuestImport> {
  const interfaces = new Set<number>();
  return {
    _if_nametoindex: (a) => (readString(cpu, a(0)) === "lo0" ? LOOPBACK_INDEX : 0),
    _getifaddrs: (a) => {
      if (!a(0)) return fail(Errno.BadAddress);
      const pointer = heap.zero(IFADDRS_BYTES);
      if (!pointer) return fail(Errno.NoMemory);
      const name = pointer + IFADDRS_NAME,
        address = pointer + IFADDRS_ADDRESS,
        mask = pointer + IFADDRS_MASK;
      cpu.write(name, encoder.encode("lo0\0"));
      cpu.write(address, sockaddrBytes(LOCAL_ADDRESS, 0));
      cpu.write(mask, sockaddrBytes(NETMASK_FIRST_BYTE, 0));
      [0, name, IFF_UP_LOOPBACK_RUNNING_MULTICAST, address, mask, 0, 0].forEach((value, index) => {
        write32(cpu, pointer + WORD_BYTES * index, value);
      });
      interfaces.add(pointer);
      write32(cpu, a(0), pointer);
      return 0;
    },
    _freeifaddrs: (a) => {
      if (interfaces.delete(a(0))) heap.free(a(0));
    },
  };
}

function nameImports(cpu: GuestMemory, heap: GuestHeap): Record<string, GuestImport> {
  let ntoa: number | undefined, host: number | undefined;
  return {
    _inet_addr: (a) => ipv4(readString(cpu, a(0))) ?? UINT32_MAX,
    _inet_ntoa: (a) => {
      const octets = Array.from(
        { length: IPV4_LENGTH },
        (_, index) => (a(0) >>> (index * BYTE_BITS)) & BYTE_MASK,
      );
      ntoa ??= heap.zero(NTOA_BYTES);
      cpu.write(ntoa, encoder.encode(octets.join(".") + "\0"));
      return ntoa;
    },
    _gethostbyname: (a) => {
      const name = readString(cpu, a(0)),
        ip = hostAddress(name);
      if (ip === null) return 0;
      host ??= heap.zero(HOSTENT_BYTES);
      const bytes = encoder.encode(name + "\0");
      if (bytes.length > HOSTENT_NAME_LIMIT) return 0;
      cpu.write(host + Hostent.NameText, bytes);
      write32(cpu, host + Hostent.Name, host + Hostent.NameText);
      write32(cpu, host + Hostent.Aliases, host + Hostent.AliasList);
      write32(cpu, host + Hostent.AddressType, AF_INET);
      write32(cpu, host + Hostent.Length, IPV4_LENGTH);
      write32(cpu, host + Hostent.AddressList, host + Hostent.Addresses);
      write32(cpu, host + Hostent.Addresses, host + Hostent.Address);
      write32(cpu, host + Hostent.Address, ip);
      return host;
    },
  };
}

export function resolverImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  fail: (errno: number) => number,
): Record<string, GuestImport> {
  return {
    ...nameImports(cpu, heap),
    ...interfaceImports(cpu, heap, fail),
    ...addressInfoImports(cpu, heap),
  };
}
