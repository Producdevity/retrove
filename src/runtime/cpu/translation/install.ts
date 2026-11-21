import type { Translation } from "./translate";
import type { TierStatistics } from "./tier-statistics";
import { countCompiled } from "../../diagnostics/compiled-code";

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
  /** The thread's in-place host import handler (`HostCalls.call`); 0 leaves at the gate. */
  host: (pc: number) => number;
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
  countCompiled(translation.wasm.length);
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
  countCompiled(translation.wasm.length);
  return { module, exports: instance.exports };
}
/** Compiles without instantiating, for code only other threads run. */
export function compileTranslation(
  translation: Translation,
  statistics: TierStatistics,
): WebAssembly.Module {
  const compiled = performance.now();
  const module = new WebAssembly.Module(translation.wasm);
  statistics.compileMs += performance.now() - compiled;
  statistics.wasmBytes += translation.wasm.length;
  countCompiled(translation.wasm.length);
  return module;
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
  const slots = reserveTranslation(table, heap, translation, labels);
  slots.forEach((slot, offset) =>
    setExport(table, slot, exports, translation.functions[offset]?.exportName ?? ""),
  );
  return slots;
}
/** Sets a table slot to the instance's exported function `name`. */
export function setExport(
  table: WebAssembly.Table,
  slot: number,
  exports: WebAssembly.Exports,
  name: string,
): void {
  const exported = exports[name];
  if (typeof exported !== "function") throw new Error(`Missing translated export ${name}.`);
  table.set(slot, exported);
}
/** Grows the table with `fill` for the module's functions and writes their label tables; returns slots. */
export function reserveTranslation(
  table: WebAssembly.Table,
  heap: Uint8Array,
  translation: Translation,
  labels: number,
  fill?: WebAssembly.ExportValue,
): number[] {
  const count = translation.functions.length,
    first = fill === undefined ? table.grow(count) : table.grow(count, fill);
  return translation.functions.map((translated, offset) => {
    const labelTable = translated.labels;
    heap.set(
      new Uint8Array(labelTable.buffer, labelTable.byteOffset, labelTable.byteLength),
      labels + translated.labelAddress,
    );
    return first + offset;
  });
}
