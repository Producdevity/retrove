import { Gauge, gauges, type Gauges } from "./gauges";

/**
 * Counts translated instances until the engine collects them. A flush drops every reference, so
 * live bytes far above the code budget mean the engine has not freed flushed code yet.
 */
export class WasmLifetimes {
  readonly #registry: FinalizationRegistry<number>;
  constructor(private readonly gauge: Gauges = gauges) {
    this.#registry = new FinalizationRegistry((bytes) => {
      gauge.add(Gauge.WasmInstancesLive, -1);
      gauge.add(Gauge.WasmBytesLive, -bytes);
    });
  }
  track(instance: object, bytes: number): void {
    this.gauge.add(Gauge.WasmInstancesCompiled, 1);
    this.gauge.add(Gauge.WasmInstancesLive, 1);
    this.gauge.add(Gauge.WasmBytesCompiled, bytes);
    this.gauge.add(Gauge.WasmBytesLive, bytes);
    this.#registry.register(instance, bytes);
  }
}

export const wasmLifetimes = new WasmLifetimes();
