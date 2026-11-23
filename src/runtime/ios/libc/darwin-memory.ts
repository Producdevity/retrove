import type { GuestMemory } from "../../memory/guest-memory";

export const PAGE_BYTES = 4096;
// The emulated iPhone 5 has 1 GiB RAM and runs on one cooperative guest processor.
const KIBIBYTE = 1024;
export const PHYSICAL_MEMORY = KIBIBYTE * KIBIBYTE * KIBIBYTE;
export interface MappedMemory extends GuestMemory {
  readonly mappedBytes: number;
}
export type Failure = (errno: number) => number;
