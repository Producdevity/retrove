import type { GuestMemory } from "../src/runtime/memory/guest-memory";
export type StringImport = (a: (n: number) => number) => number | bigint;
/** C string and wide-string imports over guest memory; `errno` is the guest address strtol-style functions set. */
export function stringImports(cpu: GuestMemory, errno: number): Record<string, StringImport>;
