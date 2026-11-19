import type { Translation } from "./translate";
import type { TierStatistics } from "./tier-statistics";

export const i32Global = (value: number): WebAssembly.Global =>
  new WebAssembly.Global({ value: "i32", mutable: false }, value);

/** Compiles a translated module; the browser compiles asynchronous instantiation off the main thread. */
export async function instantiateTranslation(
  translation: Translation,
  imports: {
    readonly memory: WebAssembly.Memory;
    readonly table: WebAssembly.Table;
    readonly arena: WebAssembly.Global;
    readonly labels: WebAssembly.Global;
  },
  statistics: TierStatistics,
): Promise<WebAssembly.Exports> {
  const compiled = performance.now();
  const { instance } = await WebAssembly.instantiate(translation.wasm, { env: imports });
  statistics.compileMs += performance.now() - compiled;
  statistics.wasmBytes += translation.wasm.length;
  return instance.exports;
}
/** Compiles and instantiates on the calling thread, for code that must run before a worker could answer. */
export function instantiateTranslationNow(
  translation: Translation,
  imports: Parameters<typeof instantiateTranslation>[1],
  statistics: TierStatistics,
): WebAssembly.Exports {
  const compiled = performance.now();
  const instance = new WebAssembly.Instance(new WebAssembly.Module(translation.wasm), {
    env: imports,
  });
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
  /** Host address of the module's label block; label addresses are offsets into it. */
  labels: number,
): number[] {
  const first = table.grow(translation.functions.length);
  return translation.functions.map((translated, offset) => {
    const exported = exports[translated.exportName];
    if (typeof exported !== "function")
      throw new Error(`Missing translated export ${translated.exportName}.`);
    table.set(first + offset, exported);
    const labelTable = translated.labels;
    heap.set(
      new Uint8Array(labelTable.buffer, labelTable.byteOffset, labelTable.byteLength),
      labels + translated.labelAddress,
    );
    return first + offset;
  });
}
