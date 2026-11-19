import type { Translation } from "./translate";
import type { TierStatistics } from "./tier-statistics";
import { wasmLifetimes } from "../../diagnostics/wasm-lifetimes";

export const i32Global = (value: number): WebAssembly.Global =>
  new WebAssembly.Global({ value: "i32", mutable: false }, value);

/**
 * Memory, table, arena and labels are shared by every guest thread's instance of a module;
 * `state` holds the host address of the state block of the thread the instance runs.
 */
export type TranslationImports = Readonly<{
  memory: WebAssembly.Memory;
  table: WebAssembly.Table;
  arena: WebAssembly.Global;
  labels: WebAssembly.Global;
  state: WebAssembly.Global;
}>;

/** The compiled module is kept so other threads can instantiate it over their own state block. */
export interface Instantiated {
  readonly module: WebAssembly.Module;
  readonly exports: WebAssembly.Exports;
}
/** Compiles a translated module; the browser compiles asynchronous instantiation off the main thread. */
export async function instantiateTranslation(
  translation: Translation,
  imports: TranslationImports,
  statistics: TierStatistics,
): Promise<Instantiated> {
  const compiled = performance.now();
  const { module, instance } = await WebAssembly.instantiate(translation.wasm, { env: imports });
  statistics.compileMs += performance.now() - compiled;
  statistics.wasmBytes += translation.wasm.length;
  wasmLifetimes.track(instance, translation.wasm.length);
  return { module, exports: instance.exports };
}
/** Compiles and instantiates on the calling thread, for code that must run before a worker could answer. */
export function instantiateTranslationNow(
  translation: Translation,
  imports: TranslationImports,
  statistics: TierStatistics,
): Instantiated {
  const compiled = performance.now();
  const module = new WebAssembly.Module(translation.wasm);
  const instance = new WebAssembly.Instance(module, { env: imports });
  statistics.compileMs += performance.now() - compiled;
  statistics.wasmBytes += translation.wasm.length;
  wasmLifetimes.track(instance, translation.wasm.length);
  return { module, exports: instance.exports };
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
