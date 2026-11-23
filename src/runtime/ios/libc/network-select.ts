import { read32, type GuestMemory } from "../../memory/guest-memory";
import { WORD_BYTES } from "../abi/scalars";
import { Errno } from "./bsd-errno";
import type { HostWait } from "./guest-imports";
import { SOCK_DGRAM, WINDOW_BYTES, type LoopbackNetwork } from "./loopback-network";

const FD_SETSIZE = 1024;
const FD_WORD_BITS = 32;
const BITS_PER_BYTE = 8;
const MICROSECONDS_PER_SECOND = 1_000_000;
const MS_PER_SECOND = 1000;
const SetKind = { Read: 0, Write: 1, Error: 2 } as const;
const SET_COUNT = 3;
const Select = { Count: 0, Read: 1, Write: 2, Error: 3, Timeout: 4 } as const;

interface FdSet {
  readonly pointer: number;
  readonly bits: Uint8Array | null;
}

function deadlineOf(cpu: GuestMemory, timeout: number): number {
  if (!timeout) return Infinity;
  const seconds = read32(cpu, timeout) | 0,
    microseconds = read32(cpu, timeout + WORD_BYTES) | 0;
  return seconds < 0 || microseconds < 0 || microseconds >= MICROSECONDS_PER_SECOND
    ? NaN
    : performance.now() + MS_PER_SECOND * seconds + microseconds / MS_PER_SECOND;
}

function ready(network: LoopbackNetwork, kind: number, fd: number): boolean {
  if (kind === SetKind.Error) return false;
  const socket = network.socketOf(fd);
  if (!socket) return true;
  if (kind === SetKind.Read)
    return Boolean(socket.rx.length || socket.eof || socket.pending.length);
  return (
    socket.type === SOCK_DGRAM ||
    Boolean(!socket.listening && socket.peer && socket.peer.pendingBytes < WINDOW_BYTES)
  );
}

export function selectSockets(
  cpu: GuestMemory,
  network: LoopbackNetwork,
  a: (index: number) => number,
): number | HostWait {
  const count = a(Select.Count) | 0;
  if (count < 0 || count > FD_SETSIZE) return network.fail(Errno.Invalid);
  const size = Math.ceil(count / FD_WORD_BITS) * WORD_BYTES,
    deadline = deadlineOf(cpu, a(Select.Timeout));
  if (Number.isNaN(deadline)) return network.fail(Errno.Invalid);
  const sets: FdSet[] = [a(Select.Read), a(Select.Write), a(Select.Error)].map((pointer) => ({
    pointer,
    bits: pointer ? cpu.read(pointer, size).slice() : null,
  }));
  function poll(): number | undefined {
    let total = 0;
    const masks = sets.map(({ bits }) => (bits ? new Uint8Array(size) : null));
    for (let fd = 0; fd < count; fd++)
      for (let kind = 0; kind < SET_COUNT; kind++) {
        const mask = 1 << (fd % BITS_PER_BYTE),
          index = fd >>> Math.log2(BITS_PER_BYTE);
        if (!((sets[kind]?.bits?.[index] ?? 0) & mask)) continue;
        if (!network.table.exists(fd)) return network.fail(Errno.BadDescriptor);
        const output = masks[kind];
        if (output && ready(network, kind, fd)) {
          output[index] = (output[index] ?? 0) | mask;
          total++;
        }
      }
    if (!total && performance.now() < deadline) return undefined;
    sets.forEach(({ pointer }, kind) => {
      const output = masks[kind];
      if (pointer && output) cpu.write(pointer, output);
    });
    return total;
  }
  return poll() ?? { wait: poll };
}
