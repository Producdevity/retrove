export const PAGE_SIZE = 4096;
export const ARM_CPU_TYPE = 12;
export const MAX_ADDRESS = 0xffffffff;
export const LoadCommand = {
  Segment: 0x1,
  Symtab: 0x2,
  UnixThread: 0x5,
  Dysymtab: 0xb,
  Dylib: 0xc,
  WeakDylib: 0x80000018,
  Reexport: 0x8000001f,
  Upward: 0x80000023,
  Encryption: 0x21,
  DyldInfo: 0x22,
  DyldInfoOnly: 0x80000022,
  Main: 0x80000028,
  ChainedFixups: 0x80000034,
  ExportsTrie: 0x80000033,
} as const;
export const SYMBOL_BYTES = 12;
const MAX_STRING_BYTES = 65536;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function requireFormat(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`Mach-O: ${message}`);
}

export function sub(bytes: Uint8Array, at: number, size: number, what: string): Uint8Array {
  requireFormat(
    Number.isSafeInteger(at) &&
      at >= 0 &&
      Number.isSafeInteger(size) &&
      size >= 0 &&
      at <= bytes.length &&
      size <= bytes.length - at,
    `invalid ${what} range`,
  );
  return bytes.subarray(at, at + size);
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function word(data: DataView, at: number): number {
  return data.getUint32(at, true);
}

export function fixedString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

export function readCString(bytes: Uint8Array, start: number): { value: string; end: number } {
  const end = bytes.indexOf(0, start);
  requireFormat(
    start >= 0 && start < bytes.length && end >= start && end - start <= MAX_STRING_BYTES,
    "invalid symbol or path",
  );
  return { value: decoder.decode(bytes.subarray(start, end)), end: end + 1 };
}
