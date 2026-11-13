import type { FloatOperation, FloatPlan } from "../wasm/float-plan";
import { Thumb } from "./instruction";
export interface FloatRegion {
  readonly address: number;
  readonly offset: number;
  readonly bytes: number;
  readonly writable: boolean;
}
export interface ScratchRegion {
  readonly address: number;
  readonly bytes: number;
}
function contains(region: ScratchRegion, address: number): boolean {
  return address >= region.address && address + Thumb.LaneBytes <= region.address + region.bytes;
}
function aligned(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value % Thumb.LaneBytes === 0;
}
function overlaps(left: ScratchRegion, right: ScratchRegion): boolean {
  return left.address < right.address + right.bytes && right.address < left.address + left.bytes;
}
export class FloatState {
  readonly operations: FloatOperation[] = [];
  readonly lanes = new Map<number, number | undefined>();
  readonly #memory = new Map<number, number | undefined>();
  readonly #outputs = new Map<number, number>();
  readonly #regions: readonly FloatRegion[];
  readonly #scratch: ScratchRegion;
  constructor(regions: readonly FloatRegion[], scratch: ScratchRegion) {
    this.#regions = regions;
    this.#scratch = scratch;
    const memory = [...regions, scratch];
    for (const [index, region] of memory.entries()) {
      if (
        !aligned(region.address) ||
        !aligned(region.bytes) ||
        region.address + region.bytes > Thumb.AddressLimit
      )
        throw new RangeError("Invalid floating-point memory region.");
      if (memory.slice(index + 1).some((other) => overlaps(region, other)))
        throw new RangeError("Floating-point memory regions overlap.");
    }
    for (const [index, region] of regions.entries()) {
      if (
        !aligned(region.offset) ||
        regions
          .slice(index + 1)
          .some((other) =>
            overlaps(
              { address: region.offset, bytes: region.bytes },
              { address: other.offset, bytes: other.bytes },
            ),
          )
      )
        throw new RangeError("Floating-point kernel buffers overlap.");
    }
  }
  #region(address: number): FloatRegion {
    const region = this.#regions.find((candidate) => contains(candidate, address));
    if (!aligned(address) || !region)
      throw new RangeError("Floating-point access is outside its declared regions.");
    return region;
  }
  load(address: number): number | undefined {
    if (this.#memory.has(address)) return this.#memory.get(address);
    if (contains(this.#scratch, address)) return undefined;
    const region = this.#region(address);
    const value = this.operations.length;
    this.operations.push({ kind: "load", offset: region.offset + address - region.address });
    this.#memory.set(address, value);
    return value;
  }
  store(address: number, value: number | undefined): void {
    if (!aligned(address)) throw new RangeError("Unaligned floating-point store.");
    if (!contains(this.#scratch, address)) {
      const region = this.#region(address);
      if (!region.writable || value === undefined)
        throw new Error("Floating-point store has no defined writable value.");
      this.#outputs.set(region.offset + address - region.address, value);
    }
    this.#memory.set(address, value);
  }
  binary(
    kind: "add" | "subtract" | "multiply",
    left: number | undefined,
    right: number | undefined,
  ): number | undefined {
    if (left === undefined || right === undefined) return undefined;
    const value = this.operations.length;
    this.operations.push({ kind, left, right });
    return value;
  }
  plan(): FloatPlan {
    return {
      memoryBytes: Math.max(
        Thumb.WordBytes,
        ...this.#regions.map((region) => region.offset + region.bytes),
      ),
      operations: this.operations,
      outputs: [...this.#outputs].map(([offset, value]) => ({ offset, value })),
    };
  }
}
