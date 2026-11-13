import { Bytes } from "../../wasm/encoding";
import { TciLimit, type TciBlock } from "../model";
import { FunctionIndex, HELPER_ARGUMENTS, Signature, Wasm } from "./abi";
import { functionBody } from "./flow";

function section(output: Bytes, id: number, content: Bytes): void {
  output.add(id).sized(content.finish());
}
function signature(output: Bytes, parameters: readonly number[], results: readonly number[]): void {
  output
    .add(Wasm.Function)
    .unsigned(parameters.length)
    .add(...parameters)
    .unsigned(results.length)
    .add(...results);
}
function word(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(TciLimit.WordBytes);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
export function tciModule(block: TciBlock, pc: number): Uint8Array<ArrayBuffer> {
  const TYPE_COUNT = 4;
  const IMPORT_COUNT = 4;
  const output = new Bytes().append(word(Wasm.Magic)).append(word(Wasm.Version)),
    types = new Bytes().unsigned(TYPE_COUNT);
  signature(types, [Wasm.I32, Wasm.I32, Wasm.I32], [Wasm.I32]);
  signature(
    types,
    HELPER_ARGUMENTS.map(() => Wasm.I32),
    [Wasm.I64],
  );
  signature(types, [Wasm.I32, Wasm.I32, Wasm.I32, Wasm.I32], [Wasm.I64]);
  signature(types, [Wasm.I32, Wasm.I32, Wasm.I64, Wasm.I32, Wasm.I32], []);
  section(output, Wasm.TypeSection, types);
  const imports = new Bytes().unsigned(IMPORT_COUNT);
  imports.name("host").name("memory").add(Wasm.MemoryImport, 0, 0);
  imports.name("host").name("table").add(Wasm.TableImport, Wasm.FunctionReference, 0, 0);
  imports.name("host").name("load").add(Wasm.FunctionImport).unsigned(Signature.Load);
  imports.name("host").name("store").add(Wasm.FunctionImport).unsigned(Signature.Store);
  section(output, Wasm.ImportSection, imports);
  section(output, Wasm.FunctionSection, new Bytes().unsigned(1).unsigned(Signature.Block));
  section(
    output,
    Wasm.ExportSection,
    new Bytes().unsigned(1).name("run").add(Wasm.FunctionImport).unsigned(FunctionIndex.Run),
  );
  section(output, Wasm.CodeSection, new Bytes().unsigned(1).sized(functionBody(block, pc)));
  return output.finish();
}
