import { GuestLayout } from "../../memory/guest-layout";
import type { Binding } from "./fixups";
import { MAX_ADDRESS, PAGE_SIZE, requireFormat } from "./format";
import type { MachOImage } from "./image";
import { executable, isPageZero } from "./segment";

const STARTUP_STACK_RESERVE = 64;
const ARGUMENT_BLOCK_BYTES = 24;
const STACK_ALIGNMENT = 16;
const WORD_BYTES = 4;
const RELATIVE_BRANCH_KIND = 3;
const HEX = 16;
const StartupOffset = { Argv: 4, Envp: 12, Apple: 16 } as const;
const ARGUMENT_COUNT = 1;

export interface MachOMemory {
  map(address: number, size: number, permissions: number): void;
  write(address: number, bytes: Uint8Array): void;
  write32(address: number, value: number): void;
  read32(address: number): number;
}
export interface LazyTarget {
  slot: number;
  target: number;
  value: number;
}
export interface LoadedImage {
  entry: number;
  entryKind: MachOImage["entryKind"];
  initializers: number[];
  lazyTargets: Map<number, LazyTarget>;
}
export type ImportResolver = (binding: Binding) => number | null | undefined;

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}

function resolveBindings(
  image: MachOImage,
  resolveImport: ImportResolver,
): { writes: [number, number][]; lazyTargets: Map<number, LazyTarget> } {
  const writes: [number, number][] = [];
  const lazyTargets = new Map<number, LazyTarget>();
  for (const binding of image.imports) {
    let target: number | null | undefined = null;
    if (binding.ordinal <= 0 || binding.mode === "weak") target = image.findExport(binding.name);
    if (isMissing(target) && binding.mode === "weak") continue;
    if (isMissing(target)) target = resolveImport(binding);
    if (isMissing(target) && binding.weak) target = 0;
    requireFormat(
      typeof target === "number" &&
        Number.isInteger(target) &&
        target >= 0 &&
        target <= MAX_ADDRESS,
      `unresolved import ${binding.name}${binding.library ? ` from ${binding.library}` : ""}`,
    );
    let value = target + binding.addend;
    if (binding.kind === RELATIVE_BRANCH_KIND) value -= binding.address + WORD_BYTES;
    writes.push([binding.address, value >>> 0]);
    if (binding.lazyOffset !== undefined) {
      lazyTargets.set(binding.lazyOffset, {
        slot: binding.address,
        target: (target + binding.addend) >>> 0,
        value: value >>> 0,
      });
    }
  }
  return { writes, lazyTargets };
}

export function loadMachO(
  image: MachOImage,
  memory: MachOMemory,
  resolveImport: ImportResolver,
): LoadedImage {
  const { writes, lazyTargets } = resolveBindings(image, resolveImport);
  for (const s of image.segments) {
    if (isPageZero(s)) continue;
    requireFormat(
      s.address + s.size <= GuestLayout.HeapBase,
      `segment ${s.name} ends above the guest heap at 0x${GuestLayout.HeapBase.toString(HEX)}`,
    );
    memory.map(s.address, s.size, s.protection);
    if (s.fileSize) {
      memory.write(s.address, image.bytes.subarray(s.fileOffset, s.fileOffset + s.fileSize));
    }
  }
  for (const [at, value] of writes) memory.write32(at, value);
  const initializers = image.initializers.map((at) => memory.read32(at));
  for (const init of initializers) {
    requireFormat(executable(image.segments, init), "initializer outside executable code");
  }
  return { entry: image.entry, entryKind: image.entryKind, initializers, lazyTargets };
}

export interface Startup {
  rawStack: number;
  args: number[];
}

/** Writes argc, argv, envp and apple[] into caller-owned guest memory. */
export function prepareStartup(
  memory: Pick<MachOMemory, "write" | "write32">,
  stackTop: number,
  path: string,
): Startup {
  requireFormat(
    Number.isInteger(stackTop) && stackTop > 0 && stackTop <= MAX_ADDRESS,
    "invalid guest stack",
  );
  requireFormat(typeof path === "string" && !path.includes("\0"), "invalid executable path");
  const encoded = new TextEncoder().encode(`${path}\0`);
  requireFormat(
    encoded.length <= PAGE_SIZE && stackTop >= encoded.length + STARTUP_STACK_RESERVE,
    "executable path exceeds stack",
  );
  const stringAt = stackTop - encoded.length;
  const rawStack =
    Math.floor((stringAt - ARGUMENT_BLOCK_BYTES) / STACK_ALIGNMENT) * STACK_ALIGNMENT;
  memory.write(stringAt, encoded);
  const argv = rawStack + StartupOffset.Argv,
    envp = rawStack + StartupOffset.Envp,
    apple = rawStack + StartupOffset.Apple;
  const block = [ARGUMENT_COUNT, stringAt, 0, 0, stringAt, 0];
  for (const [index, value] of block.entries())
    memory.write32(rawStack + index * WORD_BYTES, value);
  return { rawStack, args: [ARGUMENT_COUNT, argv, envp, apple, 0] };
}
