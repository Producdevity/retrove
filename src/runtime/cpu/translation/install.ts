import type { Translation } from "./translate";
import type { TierStatistics } from "./tier-statistics";

/** Compiles a translated module; the browser compiles asynchronous instantiation off the main thread. */
export async function instantiateTranslation(
  translation: Translation,
  imports: {
    readonly memory: WebAssembly.Memory;
    readonly table: WebAssembly.Table;
    readonly arena: WebAssembly.Global;
  },
  statistics: TierStatistics,
): Promise<WebAssembly.Exports> {
  const compiled = performance.now();
  const { instance } = await WebAssembly.instantiate(translation.wasm, { env: imports });
  statistics.compileMs += performance.now() - compiled;
  statistics.wasmBytes += translation.wasm.length;
  return instance.exports;
}
/** Adds the module's functions to the shared table and writes their label tables; returns table slots. */
export function installTranslation(
  table: WebAssembly.Table,
  heap: Uint8Array,
  exports: WebAssembly.Exports,
  translation: Translation,
  /** Label addresses in a translation are relative to the arena base. */
  arena: number,
): number[] {
  const first = table.grow(translation.functions.length);
  return translation.functions.map((translated, offset) => {
    const exported = exports[translated.exportName];
    if (typeof exported !== "function")
      throw new Error(`Missing translated export ${translated.exportName}.`);
    table.set(first + offset, exported);
    const labels = translated.labels;
    heap.set(
      new Uint8Array(labels.buffer, labels.byteOffset, labels.byteLength),
      arena + translated.labelAddress,
    );
    return first + offset;
  });
}
