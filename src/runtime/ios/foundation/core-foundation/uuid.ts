import { classPointer, type CoreFoundationFunction, type CoreFoundationHost } from "./types";

const HEX = 16;
const BYTE_DIGITS = 2;
const UUID_BYTES = 16;
const UUID_OFFSET = 4;
const UUID_VERSION_MASK = 0x0f;
const UUID_VERSION_4 = 0x40;
const UUID_VARIANT_MASK = 0x3f;
const UUID_VARIANT = 0x80;
const UUID_VERSION_BYTE = 6;
const UUID_VARIANT_BYTE = 8;
const TIME_LOW_DIGITS = 8;
const GROUP_DIGITS = 4;
const GROUPS = 3;

export function uuidFunctions(host: CoreFoundationHost): Record<string, CoreFoundationFunction> {
  const { cpu, makeString } = host;
  return {
    _CFUUIDCreate: (a) => {
      if (a(0)) return 0;
      const pointer = host.alloc(classPointer(host, "CFUUID")),
        bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTES));
      bytes[UUID_VERSION_BYTE] =
        ((bytes[UUID_VERSION_BYTE] ?? 0) & UUID_VERSION_MASK) | UUID_VERSION_4;
      bytes[UUID_VARIANT_BYTE] =
        ((bytes[UUID_VARIANT_BYTE] ?? 0) & UUID_VARIANT_MASK) | UUID_VARIANT;
      cpu.write(pointer + UUID_OFFSET, bytes);
      return pointer;
    },
    _CFUUIDCreateString: (a) => {
      if (a(0) || !a(1)) return 0;
      const hex = Array.from(cpu.read(a(1) + UUID_OFFSET, UUID_BYTES), (byte) =>
        byte.toString(HEX).padStart(BYTE_DIGITS, "0"),
      )
        .join("")
        .toUpperCase();
      const groups = [hex.slice(0, TIME_LOW_DIGITS)];
      let at = TIME_LOW_DIGITS;
      for (let i = 0; i < GROUPS; i++, at += GROUP_DIGITS)
        groups.push(hex.slice(at, at + GROUP_DIGITS));
      groups.push(hex.slice(at));
      return makeString(groups.join("-"));
    },
  };
}
