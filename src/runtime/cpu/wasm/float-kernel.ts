import type { FloatPlan } from "./float-plan";
import { floatModule } from "./float-module";
function procedure(value: unknown): value is () => void {
  return typeof value === "function";
}
export function compileFloatKernel(plan: FloatPlan): {
  readonly memory: WebAssembly.Memory;
  readonly run: () => void;
} {
  const module = new WebAssembly.Module(floatModule(plan));
  const { memory, run } = new WebAssembly.Instance(module).exports;
  if (!(memory instanceof WebAssembly.Memory) || !procedure(run))
    throw new Error("Floating-point kernel exports do not match their contract.");
  return { memory, run };
}
