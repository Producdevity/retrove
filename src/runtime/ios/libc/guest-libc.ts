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
  fallbacks: { readonly memcpy: number; readonly divide: number },
): ReadonlyMap<string, number> {
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  new DataView(code.buffer).setUint32(
    artifact.symbols.retrove_memcpy_fallback,
    fallbacks.memcpy,
    true,
  );
  new DataView(code.buffer).setUint32(
    artifact.symbols.retrove_divide_fallback,
    fallbacks.divide,
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
    ["___umodsi3", base + artifact.symbols.retrove_umod],
    ["___udivsi3", base + artifact.symbols.retrove_udiv],
    ["___modsi3", base + artifact.symbols.retrove_mod],
    ["___divsi3", base + artifact.symbols.retrove_div],
    ["___divmodsi4", base + artifact.symbols.retrove_divmod],
    ["_strcmp", base + artifact.symbols.retrove_strcmp],
  ]);
}
