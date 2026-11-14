import artifact from "./vfp.json";
const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
const SYMBOL_PREFIX = "retrove_";
interface Memory {
  write(pointer: number, bytes: Uint8Array): void;
  protect(pointer: number, size: number, permissions: number): void;
}
interface Heap {
  alloc(size: number, alignment: number): number;
}
export function vfpBuiltins(memory: Memory, heap: Heap): ReadonlyMap<string, number> {
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  if (code.length > PAGE_BYTES) throw new Error("VFP compiler helpers exceed their code page.");
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!base) throw new Error("Unable to allocate VFP compiler helpers.");
  memory.write(base, code);
  memory.protect(base, PAGE_BYTES, READ_EXECUTE);
  return new Map(
    Object.entries(artifact.symbols).map(([name, offset]): [string, number] => [
      "___" + name.slice(SYMBOL_PREFIX.length),
      base + offset,
    ]),
  );
}
