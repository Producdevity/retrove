import { EntryParameter } from "./emitter";
import type { TranslationImports } from "./install";
import { StopState, stateOffset, type StateLayout } from "./layout";
import { Code } from "./wasm-code";
import { module } from "./wasm-module";
import { Op, Type } from "./wasm-opcodes";

const MISSING_EXPORT = "missing";

/**
 * The function every unfilled table slot holds: it leaves translated code at the called PC like
 * the dispatcher does for untranslated code, so the caller fetches or instantiates that module.
 */
export function missingFunction(
  imports: TranslationImports,
  L: StateLayout,
): WebAssembly.ExportValue {
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
