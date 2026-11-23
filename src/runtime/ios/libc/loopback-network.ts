import type { GuestMemory } from "../../memory/guest-memory";
import { write32 } from "../../memory/guest-memory";
import { Errno } from "./bsd-errno";
import type { HostWait } from "./guest-imports";
import { isLoopbackIp, LOCAL_ADDRESS, type SocketAddress } from "./network-addresses";

export const SOCK_STREAM = 1;
export const SOCK_DGRAM = 2;
export const WINDOW_BYTES = 262144;
const FIRST_EPHEMERAL_PORT = 49152;
const LAST_PORT = 65535;
const EPHEMERAL_ATTEMPTS = 16384;
const MAX_DATAGRAM = 65507;
const MSG_PEEK = 2;
const MSG_DONTWAIT = 0x80;

export type SocketResult = number | HostWait;
type Poll = () => number | undefined;

export interface DescriptorTable {
  get(fd: number): { device?: LoopbackSocket; nonblocking?: boolean } | undefined;
  exists(fd: number): boolean;
  install(device: LoopbackSocket): number;
  close(fd: number): Promise<unknown>;
}

const portKey = (type: number, port: number | undefined): string => `${type}:${port}`;

export class LoopbackSocket {
  fd = 0;
  port = 0;
  ip = LOCAL_ADDRESS;
  closed = false;
  listening = false;
  eof = false;
  pendingBytes = 0;
  backlog = 0;
  remote: number | undefined;
  peer: LoopbackSocket | null | undefined;
  options: Map<string, number> | undefined;
  readonly rx: Uint8Array[] = [];
  readonly pending: LoopbackSocket[] = [];
  constructor(
    readonly type: number,
    private readonly network: LoopbackNetwork,
  ) {}
  read(pointer: number, length: number): SocketResult {
    return this.network.recv(this, pointer, length, 0);
  }
  write(pointer: number, length: number): SocketResult {
    return this.network.send(this, pointer, length, 0);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.network.unbind(this);
    if (this.peer) {
      this.peer.peer = null;
      this.peer.eof = true;
    }
    await this.network.closePending(this.pending.splice(0));
  }
}

/** Safari has no raw TCP/UDP API; the guest sees an isolated IPv4 loopback device. */
export class LoopbackNetwork {
  private readonly bound = new Map<string, LoopbackSocket>();
  private nextPort = FIRST_EPHEMERAL_PORT;
  constructor(
    private readonly cpu: GuestMemory,
    private readonly errno: number,
    readonly table: DescriptorTable,
  ) {}

  fail(code: number): number {
    write32(this.cpu, this.errno, code);
    return -1;
  }

  socketOf(fd: number): LoopbackSocket | undefined {
    return this.table.get(fd)?.device;
  }

  check(fd: number, body: (socket: LoopbackSocket) => SocketResult): SocketResult {
    const socket = this.socketOf(fd);
    return socket
      ? body(socket)
      : this.fail(this.table.exists(fd) ? Errno.NotSocket : Errno.BadDescriptor);
  }

  create(type: number): LoopbackSocket {
    const socket = new LoopbackSocket(type, this);
    socket.fd = this.table.install(socket);
    return socket;
  }

  unbind(socket: LoopbackSocket): void {
    const key = portKey(socket.type, socket.port);
    if (this.bound.get(key) === socket) this.bound.delete(key);
  }

  async closePending(sockets: LoopbackSocket[]): Promise<void> {
    for (const pending of sockets)
      if (this.table.exists(pending.fd)) await this.table.close(pending.fd);
  }

  listener(port: number): LoopbackSocket | undefined {
    return this.bound.get(portKey(SOCK_STREAM, port));
  }

  private idlePort(type: number): number {
    for (let attempt = 0; attempt < EPHEMERAL_ATTEMPTS; attempt++) {
      const port = this.nextPort;
      this.nextPort = port === LAST_PORT ? FIRST_EPHEMERAL_PORT : port + 1;
      if (!this.bound.has(portKey(type, port))) return port;
    }
    return 0;
  }

  bind(socket: LoopbackSocket, address: SocketAddress): number {
    if (socket.port) return this.fail(Errno.Invalid);
    if (address.ip !== 0 && !isLoopbackIp(address.ip)) return this.fail(Errno.AddressUnavailable);
    const port = address.port || this.idlePort(socket.type),
      key = portKey(socket.type, port);
    if (!port || this.bound.has(key)) return this.fail(Errno.AddressInUse);
    socket.ip = address.ip;
    socket.port = port;
    this.bound.set(key, socket);
    return 0;
  }

  wait(socket: LoopbackSocket, flags: number, poll: Poll): SocketResult {
    const immediate = poll();
    if (immediate !== undefined) return immediate;
    if (this.table.get(socket.fd)?.nonblocking || flags & MSG_DONTWAIT)
      return this.fail(Errno.WouldBlock);
    return { wait: () => (socket.closed ? this.fail(Errno.BadDescriptor) : poll()) };
  }

  recv(socket: LoopbackSocket, pointer: number, length: number, flags: number): SocketResult {
    if (!length) return 0;
    if (!socket.peer && !socket.eof && socket.type === SOCK_STREAM)
      return this.fail(Errno.NotConnected);
    return this.wait(socket, flags, () => {
      const first = socket.rx[0];
      if (!first) return socket.eof ? 0 : undefined;
      const count = Math.min(length, first.length);
      if (count) this.cpu.write(pointer, first.subarray(0, count));
      if (!(flags & MSG_PEEK)) {
        if (count === first.length || socket.type === SOCK_DGRAM) {
          socket.rx.shift();
          socket.pendingBytes -= first.length;
        } else {
          socket.rx[0] = first.subarray(count);
          socket.pendingBytes -= count;
        }
      }
      return count;
    });
  }

  send(socket: LoopbackSocket, pointer: number, length: number, flags: number): SocketResult {
    const destination =
      socket.type === SOCK_DGRAM ? this.bound.get(portKey(SOCK_DGRAM, socket.remote)) : socket.peer;
    if (!destination || destination.closed)
      return this.fail(
        socket.type === SOCK_DGRAM
          ? Errno.ConnectionRefused
          : socket.eof
            ? Errno.BrokenPipe
            : Errno.NotConnected,
      );
    if (socket.type === SOCK_DGRAM && length > MAX_DATAGRAM) return this.fail(Errno.MessageSize);
    return this.wait(socket, flags, () => {
      if (destination.closed) return this.fail(Errno.BrokenPipe);
      const room = WINDOW_BYTES - destination.pendingBytes;
      if (length && (!room || (socket.type === SOCK_DGRAM && length > room))) return undefined;
      const count = Math.min(room, length);
      if (count || socket.type === SOCK_DGRAM) {
        destination.rx.push(this.cpu.read(pointer, count).slice());
        destination.pendingBytes += count;
      }
      return count;
    });
  }
}
