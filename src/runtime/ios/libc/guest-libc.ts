import artifact from "./guest-libc.json";
const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
interface GuestMemory {
  write(address: number, bytes: Uint8Array): void;
  protect(address: number, size: number, permissions: number): void;
}
interface GuestHeap {
  alloc(size: number, alignment: number): number;
}
export function guestLibc(
  cpu: GuestMemory,
  heap: GuestHeap,
  memcpyFallback: number,
): ReadonlyMap<string, number> {
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  new DataView(code.buffer).setUint32(
    artifact.symbols.retrove_memcpy_fallback,
    memcpyFallback,
    true,
  );
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!base) throw new Error("Unable to allocate ARM library helpers.");
  cpu.write(base, code);
  cpu.protect(base, PAGE_BYTES, READ_EXECUTE);
  return new Map([
    ["___toupper", base + artifact.symbols.retrove_toupper],
    ["_wcslen", base + artifact.symbols.retrove_wcslen],
    ["_wcscpy", base + artifact.symbols.retrove_wcscpy],
    ["_wcscmp", base + artifact.symbols.retrove_wcscmp],
    ["_memcpy", base + artifact.symbols.retrove_memcpy],
  ]);
}
