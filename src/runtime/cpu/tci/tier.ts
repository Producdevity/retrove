import { decodeTci } from "./decode";
import { readTciAbi } from "./manifest";
import type { TciAbi } from "./model";
import { compileTciBinary, type CompiledTciBlock, type TciHost } from "./wasm/compile";
import { tciModule } from "./wasm/module";

export const TciTierLimit = { Threshold: 64, Functions: 4096, Bytes: 8_388_608 };
interface TierCallbacks {
  compile(address: number, size: number): number;
  release(index: number): void;
  clear(): void;
}
export interface TciTierModule {
  readonly HEAPU8: Uint8Array;
  readonly HEAPU32: Uint32Array;
  retroveTier?: TierCallbacks;
  getTciMemory(): WebAssembly.Memory;
  getTciTable(): WebAssembly.Table;
  _retrove_tci_constants(): number;
  _retrove_tci_constant_count(): number;
  _retrove_tci_pc(): number;
  _retrove_tci_load_entry(): number;
  _retrove_tci_store_entry(): number;
  _retrove_tci_statistics(): number;
  _retrove_tci_evict(): number;
  _retrove_tci_configure(threshold: number): void;
  addFunction(procedure: CompiledTciBlock, signature: "iiii"): number;
  removeFunction(index: number): void;
}
export interface TciTierStatistics {
  readonly recoveries: number;
  readonly evictions: number;
  readonly registered: number;
  readonly attempts: number;
  readonly executions: number;
  readonly fallbacks: number;
  readonly functions: number;
  readonly bytes: number;
  readonly failures: number;
  readonly lastFailure: string | undefined;
}
function loadProcedure(value: unknown): value is TciHost["load"] {
  return typeof value === "function";
}
function storeProcedure(value: unknown): value is TciHost["store"] {
  return typeof value === "function";
}
function host(module: TciTierModule): TciHost {
  const table = module.getTciTable(),
    memory = module.getTciMemory();
  const load: unknown = table.get(module._retrove_tci_load_entry());
  const store: unknown = table.get(module._retrove_tci_store_entry());
  if (
    !loadProcedure(load) ||
    !storeProcedure(store) ||
    (typeof SharedArrayBuffer !== "undefined" && memory.buffer instanceof SharedArrayBuffer)
  )
    throw new Error("TCI compiler requires the single-threaded ARM memory ABI.");
  return { table, memory, load, store, pc: module._retrove_tci_pc() };
}
export class TciTier {
  readonly #module: TciTierModule;
  readonly #abi: TciAbi;
  readonly #host: TciHost;
  readonly #functions = new Map<number, number>();
  #bytes = 0;
  #failures = 0;
  #lastFailure: string | undefined;
  #closed = false;
  constructor(module: TciTierModule, threshold = TciTierLimit.Threshold) {
    if (!Number.isSafeInteger(threshold) || threshold < 1)
      throw new RangeError("Invalid TCI compilation threshold.");
    if (module.retroveTier) throw new Error("The CPU already has a TCI compiler.");
    this.#module = module;
    this.#abi = readTciAbi(
      module.HEAPU8,
      module._retrove_tci_constants(),
      module._retrove_tci_constant_count(),
    );
    this.#host = host(module);
    module.retroveTier = {
      compile: (address, size) => this.#compile(address, size),
      release: (index) => this.#release(index),
      clear: () => this.#clear(),
    };
    module._retrove_tci_configure(threshold);
  }
  #compile(address: number, size: number): number {
    if (this.#closed) return 0;
    try {
      const block = decodeTci(
        this.#module.HEAPU8.subarray(address, address + size),
        address,
        this.#abi,
      );
      const binary = tciModule(block, this.#host.pc);
      if (binary.length > TciTierLimit.Bytes)
        throw new Error("Compiled TCI block exceeds the code budget.");
      while (
        this.#functions.size >= TciTierLimit.Functions ||
        this.#bytes + binary.length > TciTierLimit.Bytes
      ) {
        if (!this.#module._retrove_tci_evict())
          throw new Error("TCI cache cannot release a compiled block.");
      }
      const procedure = compileTciBinary(binary, this.#host);
      const index = this.#module.addFunction(procedure, "iiii");
      this.#functions.set(index, binary.length);
      this.#bytes += binary.length;
      return index;
    } catch (error) {
      this.#failures++;
      this.#lastFailure = error instanceof Error ? error.message : String(error);
      return 0;
    }
  }
  #release(index: number): void {
    const bytes = this.#functions.get(index);
    if (bytes === undefined) return;
    this.#module.removeFunction(index);
    this.#functions.delete(index);
    this.#bytes -= bytes;
  }
  #clear(): void {
    for (const index of this.#functions.keys()) this.#release(index);
  }
  get statistics(): TciTierStatistics {
    const WORD_BYTES = 4,
      METRICS = 6;
    const start = this.#module._retrove_tci_statistics() / WORD_BYTES;
    const [
      registered = 0,
      attempts = 0,
      executions = 0,
      fallbacks = 0,
      recoveries = 0,
      evictions = 0,
    ] = this.#module.HEAPU32.subarray(start, start + METRICS);
    return {
      recoveries,
      evictions,
      registered,
      attempts,
      executions,
      fallbacks,
      functions: this.#functions.size,
      bytes: this.#bytes,
      failures: this.#failures,
      lastFailure: this.#lastFailure,
    };
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#module._retrove_tci_configure(0);
    delete this.#module.retroveTier;
  }
}
