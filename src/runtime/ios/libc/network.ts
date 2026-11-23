import { read32, write32, type GuestMemory } from "../../memory/guest-memory";
import { Errno } from "./bsd-errno";
import type { GuestHeap, GuestImport } from "./guest-imports";
import {
  isLoopbackIp,
  LOCAL_ADDRESS,
  readSockaddr,
  sockaddrBytes,
  type SocketAddress,
} from "./network-addresses";
import {
  LoopbackNetwork,
  SOCK_DGRAM,
  SOCK_STREAM,
  type DescriptorTable,
  type LoopbackSocket,
  type SocketResult,
} from "./loopback-network";
import { resolverImports } from "./network-resolver";
import { selectSockets } from "./network-select";

export type { DescriptorTable } from "./loopback-network";

const AF_INET = 2;
const IPPROTO_TCP = 6;
const IPPROTO_UDP = 17;
const SOL_SOCKET = 0xffff;
const SO_REUSEADDR = 4;
const SO_KEEPALIVE = 8;
const SO_BROADCAST = 0x20;
const SO_NOSIGPIPE = 0x1022;
const TCP_NODELAY = 1;
const SOCKET_OPTIONS = [SO_REUSEADDR, SO_KEEPALIVE, SO_BROADCAST, SO_NOSIGPIPE];
const OPTION_BYTES = 4;
const UNSPECIFIED: SocketAddress = { ip: 0, port: 0 };
const Socket = { Domain: 0, Type: 1, Protocol: 2 } as const;
const Fd = { Socket: 0, Address: 1, Length: 2 } as const;
const Listen = { Socket: 0, Backlog: 1 } as const;
const Transfer = { Socket: 0, Buffer: 1, Length: 2, Flags: 3 } as const;
const Option = { Socket: 0, Level: 1, Name: 2, Value: 3, Length: 4 } as const;

function connectSocket(
  network: LoopbackNetwork,
  socket: LoopbackSocket,
  address: SocketAddress,
): SocketResult {
  if (!isLoopbackIp(address.ip)) return network.fail(Errno.NetworkUnreachable);
  if (socket.peer || socket.listening) return network.fail(Errno.AlreadyConnected);
  if (!socket.port && network.bind(socket, { ip: LOCAL_ADDRESS, port: 0 }) < 0) return -1;
  socket.remote = address.port;
  if (socket.type === SOCK_DGRAM) return 0;
  const listener = network.listener(address.port);
  if (!listener?.listening || listener.pending.length >= listener.backlog)
    return network.fail(Errno.ConnectionRefused);
  const server = network.create(SOCK_STREAM);
  server.port = listener.port;
  server.peer = socket;
  socket.peer = server;
  listener.pending.push(server);
  return 0;
}

function acceptSocket(
  cpu: GuestMemory,
  network: LoopbackNetwork,
  socket: LoopbackSocket,
  destination: number,
  length: number,
): SocketResult {
  if (!socket.listening) return network.fail(Errno.Invalid);
  if (destination && !length) return network.fail(Errno.BadAddress);
  return network.wait(socket, 0, () => {
    const accepted = socket.pending.shift();
    if (!accepted) return undefined;
    if (destination) {
      const bytes = sockaddrBytes(LOCAL_ADDRESS, accepted.peer?.port || 0);
      cpu.write(destination, bytes.subarray(0, read32(cpu, length)));
      write32(cpu, length, bytes.length);
    }
    return accepted.fd;
  });
}

function setOption(
  cpu: GuestMemory,
  network: LoopbackNetwork,
  socket: LoopbackSocket,
  a: (index: number) => number,
): number {
  if (!a(Option.Value) || a(Option.Length) < OPTION_BYTES) return network.fail(Errno.Invalid);
  const level = a(Option.Level),
    name = a(Option.Name);
  const supported =
    (level === SOL_SOCKET && SOCKET_OPTIONS.includes(name)) ||
    (level === IPPROTO_TCP && name === TCP_NODELAY && socket.type === SOCK_STREAM);
  if (!supported) return network.fail(Errno.NoProtocolOption);
  // Loopback has no packet coalescing, keepalive probes or outbound signals.
  socket.options ??= new Map();
  socket.options.set(level + ":" + name, read32(cpu, a(Option.Value)));
  return 0;
}

export function networkImports(
  cpu: GuestMemory,
  heap: GuestHeap,
  errno: number,
  table: DescriptorTable,
): Record<string, GuestImport> {
  const network = new LoopbackNetwork(cpu, errno, table);
  const fail = (code: number): number => network.fail(code);
  return {
    ...resolverImports(cpu, heap, fail),
    _socket: (a) => {
      const type = a(Socket.Type);
      if (a(Socket.Domain) !== AF_INET) return fail(Errno.AddressFamilyUnsupported);
      if (type !== SOCK_STREAM && type !== SOCK_DGRAM) return fail(Errno.SocketTypeUnsupported);
      const protocol = a(Socket.Protocol);
      if (protocol && protocol !== (type === SOCK_STREAM ? IPPROTO_TCP : IPPROTO_UDP))
        return fail(Errno.ProtocolUnsupported);
      return network.create(type).fd;
    },
    _bind: (a) =>
      network.check(a(Fd.Socket), (socket) => {
        const address = readSockaddr(cpu, a(Fd.Address), a(Fd.Length));
        return address ? network.bind(socket, address) : fail(Errno.Invalid);
      }),
    _listen: (a) =>
      network.check(a(Listen.Socket), (socket) => {
        if (socket.type !== SOCK_STREAM || socket.peer) return fail(Errno.NotSupported);
        if (!socket.port && network.bind(socket, UNSPECIFIED) < 0) return -1;
        socket.listening = true;
        socket.backlog = Math.max(1, a(Listen.Backlog) | 0);
        return 0;
      }),
    _connect: (a) =>
      network.check(a(Fd.Socket), (socket) => {
        const address = readSockaddr(cpu, a(Fd.Address), a(Fd.Length));
        return address ? connectSocket(network, socket, address) : fail(Errno.Invalid);
      }),
    _accept: (a) =>
      network.check(a(Fd.Socket), (socket) =>
        acceptSocket(cpu, network, socket, a(Fd.Address), a(Fd.Length)),
      ),
    _recv: (a) =>
      network.check(a(Transfer.Socket), (socket) =>
        network.recv(socket, a(Transfer.Buffer), a(Transfer.Length), a(Transfer.Flags)),
      ),
    _send: (a) =>
      network.check(a(Transfer.Socket), (socket) =>
        network.send(socket, a(Transfer.Buffer), a(Transfer.Length), a(Transfer.Flags)),
      ),
    _setsockopt: (a) =>
      network.check(a(Option.Socket), (socket) => setOption(cpu, network, socket, a)),
    _select: (a) => selectSockets(cpu, network, a),
  };
}
