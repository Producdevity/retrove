import type { Argument } from "../../ios/libc/pure-math";

/** Returned by a local import that cannot answer on this thread; the main thread runs the call. */
export const Forward = Symbol("forward");
export type LocalImport = (a: Argument) => number | bigint | undefined | typeof Forward;
