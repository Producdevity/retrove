import { Gauge, gauges, type Gauges } from "../../diagnostics/gauges";

/**
 * Live translated Wasm before every module is dropped. Engines keep compiled code for as long
 * as a module is referenced, and iOS closes a page well before desktop browsers run short.
 * 64 MiB.
 */
export const CODE_BUDGET_BYTES = 67_108_864;

/** Tracks the live translated code that a flush releases. */
export class CodeBudget {
  #live = 0;
  constructor(
    readonly limit = CODE_BUDGET_BYTES,
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
    this.gauge.add(Gauge.TranslatedCodeBytes, -this.#live);
    this.#live = 0;
  }
}
