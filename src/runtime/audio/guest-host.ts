import type { Heap } from "../memory/guest-memory";

/** Runs guest code at `entry`; `wide` asks for the 64-bit result. */
export type GuestCall = (
  entry: number,
  args: readonly number[],
  wide?: boolean,
) => number | bigint | Promise<number | bigint>;
export type GuestHeap = Pick<Heap, "alloc" | "zero" | "free">;
export type AudioContextSource = () => AudioContext | null | undefined;
