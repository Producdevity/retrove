import { EntryParameter } from "../translation/emitter";
import { FunctionIndex } from "../translation/function-index";
import { ForeignPages } from "../translation/foreign-pages";
import { i32Global, type TranslationImports } from "../translation/install";
import { PageBits, StopState, stateOffset, type StateLayout } from "../translation/layout";
import type { CompiledModule } from "../translation/tier-options";
import { module } from "../translation/wasm-module";
import { Code } from "../translation/wasm-code";
import { Op, Type } from "../translation/wasm-opcodes";

const WORD_ALIGNMENT = 3;
const MISSING_EXPORT = "missing";

/**
 * The function every unfilled slot of a worker's table holds: it leaves translated code at the
 * called PC like the dispatcher does for untranslated code, so the worker fetches that module.
 */
function missingFunction(imports: TranslationImports, L: StateLayout): WebAssembly.ExportValue {
  const c = new Code(1);
  c.state().i32(StopState.Exit).memory(Op.I32Store, stateOffset(L, L.stopped));
  c.state().get(EntryParameter).memory(Op.I32Store, stateOffset(L, L.exitPC));
  c.get(EntryParameter);
  const wasm = module({
    types: [{ params: [Type.I32], results: [Type.I32] }],
    functions: [{ type: 0, code: c, exportName: MISSING_EXPORT }],
    shared: true,
  });
  const exported = new WebAssembly.Instance(new WebAssembly.Module(wasm), { env: imports }).exports[
    MISSING_EXPORT
  ];
  if (typeof exported !== "function") throw new Error("Missing-slot function did not compile.");
  return exported;
}

/**
 * A worker's own function table. Its slots mirror the main thread's slot numbers, because
 * translated code reaches other functions through the shared address index, which holds main
 * table slots. Slots are filled on demand by instantiating the main thread's compiled modules
 * over this worker's state block.
 */
export class WorkerCode {
  readonly table = new WebAssembly.Table({ element: "anyfunc", initial: 0 });
  readonly #imports: TranslationImports;
  readonly #missing: WebAssembly.ExportValue;
  readonly #filled = new Set<number>();
  readonly #index: FunctionIndex;
  readonly #foreign: ForeignPages | undefined;
  #generation: number;
  constructor(
    memory: WebAssembly.Memory,
    private readonly layout: () => StateLayout,
    generation: number,
  ) {
    const L = layout(),
      view = new DataView(memory.buffer);
    this.#imports = {
      memory,
      table: this.table,
      arena: i32Global(L.arena),
      labels: i32Global(0),
      state: i32Global(L.registers),
    };
    this.#missing = missingFunction(this.#imports, L);
    this.#index = new FunctionIndex(
      () => view,
      () => this.layout().index,
    );
    this.#foreign = L.foreign && new ForeignPages(L.foreign.base, () => view);
    this.#generation = generation;
  }
  get generation(): number {
    return this.#generation;
  }
  /** Main table slot + 1 for a guest PC, 0 when the main thread has nothing translated there. */
  entry(pc: number): number {
    const inside = this.#index.get(pc);
    if (inside !== undefined) return inside;
    if (pc & WORD_ALIGNMENT) return 0;
    return this.#foreign?.entry(pc >>> PageBits) ?? 0;
  }
  has(slot: number): boolean {
    return this.#filled.has(slot);
  }
  /** Grows the table with missing-slot functions, so every slot translated code can reach exists. */
  reserve(slots: number): void {
    if (slots > this.table.length) this.table.grow(slots - this.table.length, this.#missing);
  }
  install(compiled: CompiledModule): void {
    const exports = new WebAssembly.Instance(compiled.module, {
      env: { ...this.#imports, labels: i32Global(compiled.labels) },
    }).exports;
    this.reserve(Math.max(...compiled.slots) + 1);
    compiled.slots.forEach((slot, offset) => {
      const exported = exports[compiled.exports[offset] ?? ""];
      if (typeof exported !== "function") throw new Error("Missing translated export.");
      this.table.set(slot, exported);
      this.#filled.add(slot);
    });
  }
  /** Drops every instance after the main thread reused label blocks for a new generation. */
  renew(generation: number): void {
    for (const slot of this.#filled) this.table.set(slot, this.#missing);
    this.#filled.clear();
    this.#generation = generation;
  }
}
