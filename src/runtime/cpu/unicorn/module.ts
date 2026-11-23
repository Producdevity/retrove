import createUnicorn from "../../../../web/vendor/unicorn-arm.mjs";
import { isRecord } from "../../../domain/validation";
import type { TciTierModule } from "../tci/tier";
import type { BridgeModule } from "../translation/register-bridge";
import type { TierModule } from "../translation/tier";

const CORE_REGISTERS = 16;
const DOUBLE_REGISTERS = 32;

const CONSTANTS = [
  "ARCH_ARM",
  "MODE_ARM",
  "ERR_OK",
  "ARM_REG_CPSR",
  "ARM_REG_FPSCR",
  "ARM_REG_FPEXC",
  "ARM_REG_PC",
  "ARM_REG_C1_C0_2",
  "ARM_REG_C13_C0_3",
  "HOOK_CODE",
  "HOOK_MEM_READ_UNMAPPED",
  "HOOK_MEM_WRITE_UNMAPPED",
  "HOOK_MEM_FETCH_UNMAPPED",
  "HOOK_MEM_READ_PROT",
  "HOOK_MEM_WRITE_PROT",
  "HOOK_MEM_FETCH_PROT",
  "MEM_READ_UNMAPPED",
  "MEM_WRITE_UNMAPPED",
  "MEM_FETCH_UNMAPPED",
  "MEM_READ_PROT",
  "MEM_WRITE_PROT",
  "MEM_FETCH_PROT",
] as const;
const FUNCTIONS = [
  "Unicorn",
  "getValue",
  "ccall",
  "strerror",
  "_malloc",
  "_free",
  "_uc_mem_read",
  "_uc_mem_write",
  "_uc_reg_read",
  "_uc_reg_write",
  "_retrove_tci_invalidate",
  "_retrove_tci_constants",
  "_retrove_tci_constant_count",
  "_retrove_tci_pc",
  "_retrove_tci_load_entry",
  "_retrove_tci_store_entry",
  "_retrove_tci_statistics",
  "_retrove_tci_evict",
  "_retrove_tci_configure",
  "_retrove_budget_create",
  "_retrove_budget_start",
  "_retrove_budget_close",
  "getTciMemory",
  "getTciTable",
  "addFunction",
  "removeFunction",
] as const;
const ENGINE_METHODS = [
  "mem_map",
  "mem_unmap",
  "mem_protect",
  "hook_add",
  "hook_del",
  "emu_start",
  "emu_stop",
  "context_alloc",
  "context_save",
  "context_restore",
  "context_free",
  "close",
] as const;

type UnicornConstants = Readonly<Record<(typeof CONSTANTS)[number], number>>;
/** Unicorn.js passes 64-bit guest addresses as BigInt; other hook arguments are numbers. */
export type UnicornHook = (
  engine: unknown,
  first: unknown,
  second: unknown,
  third: unknown,
) => boolean | void;
/** The Unicorn.js engine object; its hook handles are opaque. */
export interface UnicornEngine {
  readonly handle_ptr: number;
  mem_map(address: number, size: number, permissions: number): void;
  mem_unmap(address: number, size: number): void;
  mem_protect(address: number, size: number, permissions: number): void;
  hook_add(type: number, callback: UnicornHook, data?: null, begin?: number, end?: number): unknown;
  hook_del(hook: unknown): void;
  emu_start(begin: number, until: number, timeout: number, count: number): void;
  emu_stop(): void;
  context_alloc(): number;
  context_save(context: number): void;
  context_restore(context: number): void;
  context_free(context: number): void;
  close(): void;
}
export interface UnicornModule extends TciTierModule, TierModule, BridgeModule, UnicornConstants {
  readonly Unicorn: new (arch: number, mode: number) => unknown;
  getValue(pointer: number, type: "*"): number;
  ccall(
    name: string,
    returnType: "number",
    argumentTypes: readonly string[],
    args: readonly (number | bigint)[],
  ): number;
  _uc_mem_read(engine: number, address: bigint, destination: number, size: bigint): number;
  _uc_mem_write(engine: number, address: bigint, source: number, size: bigint): number;
  _retrove_tci_invalidate(engine: number, address: number, size: number): number;
  _retrove_budget_create(engine: number): number;
  _retrove_budget_start(budget: number, instructions: number): void;
  _retrove_budget_close(budget: number): void;
}
export interface LoadedUnicorn {
  readonly uc: UnicornModule;
  /** Unicorn register ids of r0-r15 and d0-d31. */
  readonly core: readonly number[];
  readonly doubles: readonly number[];
}

function isUnicornModule(value: unknown): value is UnicornModule {
  if (!isRecord(value)) return false;
  return (
    FUNCTIONS.every((name) => typeof value[name] === "function") &&
    CONSTANTS.every((name) => typeof value[name] === "number") &&
    value["HEAPU8"] instanceof Uint8Array &&
    value["HEAPU32"] instanceof Uint32Array
  );
}
function isUnicornEngine(value: unknown): value is UnicornEngine {
  if (!isRecord(value)) return false;
  return (
    typeof value["handle_ptr"] === "number" &&
    ENGINE_METHODS.every((name) => typeof value[name] === "function")
  );
}
function registerIds(module: Record<string, unknown>, prefix: string, count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const id = module[`${prefix}${index}`];
    if (typeof id !== "number") throw new TypeError(`Unicorn is missing ${prefix}${index}.`);
    return id;
  });
}

export async function loadUnicorn(): Promise<LoadedUnicorn> {
  const uc = await createUnicorn();
  if (!isRecord(uc) || !isUnicornModule(uc))
    throw new TypeError("Unicorn is missing required exports.");
  return {
    uc,
    core: registerIds(uc, "ARM_REG_R", CORE_REGISTERS),
    doubles: registerIds(uc, "ARM_REG_D", DOUBLE_REGISTERS),
  };
}
export function openEngine(uc: UnicornModule): UnicornEngine {
  const engine = new uc.Unicorn(uc.ARCH_ARM, uc.MODE_ARM);
  if (!isUnicornEngine(engine)) throw new TypeError("Unicorn engine is missing required methods.");
  return engine;
}
