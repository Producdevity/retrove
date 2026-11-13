import { Bytes } from "./encoding";
import type { FloatPlan } from "./float-plan";
import { validateFloatPlan } from "./float-plan";
const Wasm = {
  Magic: 0x6d736100,
  Version: 1,
  WordBytes: 4,
  PageBytes: 65_536,
  TypeSection: 1,
  FunctionSection: 3,
  MemorySection: 5,
  ExportSection: 7,
  CodeSection: 10,
  FunctionType: 0x60,
  Float: 0x7d,
  Integer: 0x7f,
  FloatAlignment: 2,
  Functions: 2,
  Exports: 2,
  FunctionExport: 0,
  MemoryExport: 2,
};
const Op = {
  If: 0x04,
  Else: 0x05,
  End: 0x0b,
  Call: 0x10,
  Get: 0x20,
  Set: 0x21,
  Tee: 0x22,
  Load: 0x2a,
  Store: 0x38,
  Integer: 0x41,
  Float: 0x43,
  LessUnsigned: 0x49,
  NotEqualFloat: 0x5c,
  And: 0x71,
  Add: 0x92,
  Subtract: 0x93,
  Multiply: 0x94,
  FloatBits: 0xbc,
  BitsFloat: 0xbe,
};
const FloatBits = {
  Magnitude: 0x7fff_ffff,
  MinimumNormal: 0x0080_0000,
  Sign: -0x8000_0000,
  NaN: 0x7fc0_0000,
};
function word(value: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(Wasm.WordBytes);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function integer(bytes: Bytes, value: number): Bytes {
  return bytes.add(Op.Integer).signed(value);
}
function normalizer(): Uint8Array<ArrayBuffer> {
  const code = new Bytes().add(1, 1, Wasm.Integer, Op.Get, 0, Op.FloatBits, Op.Tee, 1);
  integer(code, FloatBits.Magnitude).add(Op.And);
  integer(code, FloatBits.MinimumNormal).add(Op.LessUnsigned, Op.If, Wasm.Float, Op.Get, 1);
  integer(code, FloatBits.Sign).add(
    Op.And,
    Op.BitsFloat,
    Op.Else,
    Op.Get,
    0,
    Op.Get,
    0,
    Op.NotEqualFloat,
    Op.If,
    Wasm.Float,
    Op.Float,
  );
  code.append(word(FloatBits.NaN)).add(Op.Else, Op.Get, 0, Op.End, Op.End, Op.End);
  return code.finish();
}
function kernel(plan: FloatPlan): Uint8Array<ArrayBuffer> {
  const code = new Bytes().unsigned(1).unsigned(plan.operations.length).add(Wasm.Float);
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.kind === "load")
      integer(code, operation.offset).add(Op.Load, Wasm.FloatAlignment, 0);
    else {
      code.add(Op.Get).unsigned(operation.left);
      if (plan.operations[operation.left]?.kind === "load") code.add(Op.Call, 0);
      code.add(Op.Get).unsigned(operation.right);
      if (plan.operations[operation.right]?.kind === "load") code.add(Op.Call, 0);
      code.add(
        operation.kind === "add"
          ? Op.Add
          : operation.kind === "subtract"
            ? Op.Subtract
            : Op.Multiply,
      );
    }
    if (operation.kind !== "load") code.add(Op.Call, 0);
    code.add(Op.Set).unsigned(index);
  }
  for (const output of plan.outputs) {
    integer(code, output.offset)
      .add(Op.Get)
      .unsigned(output.value)
      .add(Op.Store, Wasm.FloatAlignment, 0);
  }
  return code.add(Op.End).finish();
}
function section(output: Bytes, id: number, content: Bytes): void {
  output.add(id).sized(content.finish());
}
export function floatModule(plan: FloatPlan): Uint8Array<ArrayBuffer> {
  validateFloatPlan(plan);
  const output = new Bytes().append(word(Wasm.Magic)).append(word(Wasm.Version));
  const types = new Bytes()
    .unsigned(Wasm.Functions)
    .add(Wasm.FunctionType, 0, 0, Wasm.FunctionType, 1, Wasm.Float, 1, Wasm.Float);
  section(output, Wasm.TypeSection, types);
  section(output, Wasm.FunctionSection, new Bytes().unsigned(Wasm.Functions).add(1, 0));
  const pages = Math.ceil(plan.memoryBytes / Wasm.PageBytes);
  section(output, Wasm.MemorySection, new Bytes().add(1, 1).unsigned(pages).unsigned(pages));
  const exports = new Bytes()
    .unsigned(Wasm.Exports)
    .name("memory")
    .add(Wasm.MemoryExport, 0)
    .name("run")
    .add(Wasm.FunctionExport, 1);
  section(output, Wasm.ExportSection, exports);
  section(
    output,
    Wasm.CodeSection,
    new Bytes().unsigned(Wasm.Functions).sized(normalizer()).sized(kernel(plan)),
  );
  return output.finish();
}
