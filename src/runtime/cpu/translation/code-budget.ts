import { Gauge, gauges, type Gauges } from "../../diagnostics/gauges";

/**
 * Live translated Wasm before every module is dropped. Engines keep compiled code for as long
 * as a module is referenced, and iOS closes a page well before desktop browsers run short.
 * 64 MiB.
 */
export const CODE_BUDGET_BYTES = 67_108_864;

/** Tracks the translated code and label tables that a flush releases together. */
export class CodeBudget {
  /** Raw allocations of label tables, freed when their modules are dropped. */
  readonly labels: number[] = [];
  #live = 0;
  constructor(
    private readonly free: (pointer: number) => void,
    private readonly limit = CODE_BUDGET_BYTES,
    private readonly gauge: Gauges = gauges,
  ) {}
  add(bytes: number): void {
    this.#live += bytes;
    this.gauge.add(Gauge.TranslatedCodeBytes, bytes);
  }
  get exceeded(): boolean {
    return this.#live > this.limit;
  }
  release(): void {
    for (const pointer of this.labels.splice(0)) this.free(pointer);
    this.gauge.add(Gauge.TranslatedCodeBytes, -this.#live);
    this.#live = 0;
  }
}
