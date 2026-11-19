import { Word } from "./emit-constants";
import { relative, type StateLayout } from "./layout";
import { Code } from "./wasm-code";
import { Op, Type, type ValueType } from "./wasm-opcodes";

/** Guest registers r0-r14 kept in locals; the PC is never cached. */
export const CachedRegisters = 15;
const FLAGS = 4;
/** Words a call site spills and reloads: r0-r14, then N Z C V, then the VFP N Z C V. */
export const StateWords = CachedRegisters + FLAGS + FLAGS;

function addresses(L: StateLayout): number[] {
  const at = (base: number, count: number) =>
    Array.from({ length: count }, (_, index) => base + Word.Bytes * index);
  return [...at(L.registers, CachedRegisters), ...at(L.flags, FLAGS), ...at(L.fpFlags, FLAGS)];
}
export const stateTypes = (): readonly ValueType[] =>
  Array.from({ length: StateWords }, () => Type.I32);

/**
 * Writes the cached state to the state block. Call sites pass their locals instead of inlining
 * a store per word, which made spills around calls most of a module's size.
 */
export function emitSpill(L: StateLayout): Code {
  const c = new Code(StateWords);
  addresses(L).forEach((address, index) =>
    c.arena().get(index).memory(Op.I32Store, relative(L, address)),
  );
  return c;
}
/** Returns the state block's words in spill order. */
export function emitReload(L: StateLayout): Code {
  const c = new Code(0);
  for (const address of addresses(L)) c.arena().memory(Op.I32Load, relative(L, address));
  return c;
}
