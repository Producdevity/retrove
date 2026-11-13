export type FloatOperation =
  | { readonly kind: "load"; readonly offset: number }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: number;
      readonly right: number;
    };
export interface FloatOutput {
  readonly offset: number;
  readonly value: number;
}
export interface FloatPlan {
  readonly memoryBytes: number;
  readonly operations: readonly FloatOperation[];
  readonly outputs: readonly FloatOutput[];
}
const Limits = { FloatBytes: 4, MemoryBytes: 4_194_304, Operations: 65_535, Outputs: 65_535 };
function address(offset: number, size: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset % Limits.FloatBytes ||
    offset + Limits.FloatBytes > size
  )
    throw new RangeError("Floating-point kernel memory address is outside its buffer.");
}
export function validateFloatPlan(plan: FloatPlan): void {
  if (
    !Number.isSafeInteger(plan.memoryBytes) ||
    plan.memoryBytes < Limits.FloatBytes ||
    plan.memoryBytes > Limits.MemoryBytes ||
    plan.operations.length > Limits.Operations ||
    plan.outputs.length > Limits.Outputs
  )
    throw new RangeError("Floating-point kernel exceeds its compilation limits.");
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.kind === "load") address(operation.offset, plan.memoryBytes);
    else
      for (const reference of [operation.left, operation.right]) {
        if (!Number.isSafeInteger(reference) || reference < 0 || reference >= index)
          throw new RangeError("Floating-point kernel references an unavailable value.");
      }
  }
  for (const output of plan.outputs) {
    address(output.offset, plan.memoryBytes);
    if (
      !Number.isSafeInteger(output.value) ||
      output.value < 0 ||
      output.value >= plan.operations.length
    )
      throw new RangeError("Floating-point kernel output references an unavailable value.");
  }
}
