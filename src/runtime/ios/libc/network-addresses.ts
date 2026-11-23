import { read32, type GuestMemory } from "../../memory/guest-memory";

export const LOCAL_ADDRESS = 0x0100007f;
export const AF_INET = 2;
export const SOCKADDR_BYTES = 16;
const SOCKADDR_PROBE_BYTES = 8;
const LOOPBACK_OCTET = 127;
const BINARY_BASE = 2;
const BYTE_MASK = 0xff;
const BYTE_BITS = 8;
const OCTET_COUNT = 4;
const LENGTH_FIELD = 0;
const FAMILY_FIELD = 1;
const PORT_FIELD = 2;
const ADDRESS_FIELD = 4;
const HIGH_BYTE = 24;
const LOW_BYTE_SHIFT = 8;
const MIDDLE_HIGH_MASK = 0xff00;
const MIDDLE_LOW_MASK = 0xff0000;
const HEX_LITERAL = /^0[xX][0-9a-fA-F]+$/;
const OCTAL_LITERAL = /^0[0-7]+$/;
const DECIMAL_LITERAL = /^(?:0|[1-9][0-9]*)$/;

export interface SocketAddress {
  readonly port: number;
  readonly ip: number;
}

export const isLoopbackIp = (ip: number): boolean => (ip & BYTE_MASK) === LOOPBACK_OCTET;

/** inet_addr rules: one to four parts, each decimal, octal or hex, the last filling the remaining bytes. */
export function ipv4(text: string): number | null {
  const parts = text.split(".");
  if (!parts.length || parts.length > OCTET_COUNT) return null;
  let result = 0;
  for (const [index, part] of parts.entries()) {
    const octal = OCTAL_LITERAL.test(part);
    if (!HEX_LITERAL.test(part) && !octal && !DECIMAL_LITERAL.test(part)) return null;
    const value = Number(octal ? "0o" + part : part),
      width = index === parts.length - 1 ? BYTE_BITS * (OCTET_COUNT + 1 - parts.length) : BYTE_BITS;
    if (value >= BINARY_BASE ** width) return null;
    result = result * BINARY_BASE ** width + value;
  }
  return (
    ((result >>> HIGH_BYTE) |
      ((result >>> LOW_BYTE_SHIFT) & MIDDLE_HIGH_MASK) |
      ((result << LOW_BYTE_SHIFT) & MIDDLE_LOW_MASK) |
      (result << HIGH_BYTE)) >>>
    0
  );
}

export function readSockaddr(
  cpu: GuestMemory,
  pointer: number,
  size: number,
): SocketAddress | null {
  if (!pointer || size < SOCKADDR_PROBE_BYTES) return null;
  const bytes = cpu.read(pointer, SOCKADDR_PROBE_BYTES);
  if (bytes[FAMILY_FIELD] !== AF_INET) return null;
  return {
    port: (bytes[PORT_FIELD] ?? 0) * (BYTE_MASK + 1) + (bytes[PORT_FIELD + 1] ?? 0),
    ip: read32(cpu, pointer + ADDRESS_FIELD),
  };
}

export function sockaddrBytes(ip: number, port: number): Uint8Array {
  const bytes = new Uint8Array(SOCKADDR_BYTES);
  bytes[LENGTH_FIELD] = SOCKADDR_BYTES;
  bytes[FAMILY_FIELD] = AF_INET;
  bytes[PORT_FIELD] = port >>> BYTE_BITS;
  bytes[PORT_FIELD + 1] = port & BYTE_MASK;
  new DataView(bytes.buffer).setUint32(ADDRESS_FIELD, ip, true);
  return bytes;
}
