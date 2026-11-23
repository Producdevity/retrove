import type { Heap } from "../../memory/guest-memory";
import type { GuestArguments, HostResult } from "../objc/host";

export type { GuestJump, HostWait } from "../objc/host";
export type GuestHeap = Pick<Heap, "alloc" | "free" | "zero" | "string">;
export const ADDRESS_SPACE = 0x1_0000_0000;
export const UINT32_MAX = 0xffff_ffff;
export type GuestImport = (a: GuestArguments) => HostResult | Promise<HostResult>;
