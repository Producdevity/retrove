import type { CompiledModule, ModuleSink } from "../translation/tier-options";
import { WorkerControl } from "./channel";

/**
 * The main thread's compiled modules by table slot, for execution workers to instantiate. A flush
 * moves every worker to a new generation before the tier reuses label blocks.
 */
export class ModuleRegistry implements ModuleSink {
  readonly control = new WorkerControl();
  readonly #slots = new Map<number, CompiledModule>();
  record(compiled: CompiledModule): void {
    for (const slot of compiled.slots) this.#slots.set(slot, compiled);
    this.control.publishSlots(Math.max(...compiled.slots) + 1);
  }
  flush(): void {
    this.control.advance();
    this.#slots.clear();
  }
  at(slot: number): CompiledModule | undefined {
    return this.#slots.get(slot);
  }
}
