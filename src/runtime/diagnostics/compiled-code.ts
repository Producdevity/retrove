import { Gauge, gauges, type Gauges } from "./gauges";

/**
 * Counts every translated instance and its Wasm bytes. WebKit frees dropped instances but never
 * runs finalizers for them, so live counts come from the code budget, not from collection.
 */
export function countCompiled(bytes: number, gauge: Gauges = gauges): void {
  gauge.add(Gauge.WasmInstancesCompiled, 1);
  gauge.add(Gauge.WasmBytesCompiled, bytes);
}
