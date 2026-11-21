import type { GuestMemory } from "../src/runtime/memory/guest-memory";
export type FormatImport = (a: (n: number) => number) => number;
/** snprintf, sprintf and their v- and checked variants over guest memory. */
export function bufferImports(cpu: GuestMemory): Record<string, FormatImport>;
