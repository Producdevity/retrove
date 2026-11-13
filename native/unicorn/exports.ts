import type { TciTierModule } from "../../src/runtime/cpu/tci/tier";
declare const Module: Pick<TciTierModule, "getTciMemory" | "getTciTable">;
declare const wasmMemory: WebAssembly.Memory;
declare const wasmTable: WebAssembly.Table;
Module["getTciMemory"] = () => wasmMemory;
Module["getTciTable"] = () => wasmTable;
