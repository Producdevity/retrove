import type { GuestCPU } from "../../../../../../web/cpu.mjs";
import { planFloatProgram } from "../../../../cpu/thumb/float-program";
import type { FloatProgram } from "../../../../cpu/thumb/float-program";
import { compileFloatKernel } from "../../../../cpu/wasm/float-kernel";
import type { FloatRegion } from "../../../../cpu/thumb/float-state";
import type { KernelHost } from "../kernels";
const Abi = {
  WordBytes: 4,
  PatchBytes: 8,
  PageBytes: 4096,
  ReadExecute: 5,
  AddressLimit: 0x1_0000_0000,
  Return: 14,
  Thumb: 1,
  Jump: 0xf000f8df,
};
interface Transform {
  readonly name: string;
  readonly entry: {
    readonly Address: number;
    readonly First: number;
    readonly Second: number;
    readonly Start: number;
    readonly End: number;
    readonly Epilogue: number;
  };
  readonly program: Omit<FloatProgram, "address" | "code">;
  addresses(): readonly number[] | undefined;
}
export function readWord(cpu: GuestCPU, address: number): number {
  return cpu.read32(address);
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * Abi.WordBytes),
    view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * Abi.WordBytes, value, true));
  return bytes;
}
function bindings(regions: readonly FloatRegion[], addresses: readonly number[] | undefined) {
  if (!addresses || addresses.length !== regions.length) return undefined;
  const result = regions.map((region, index) => ({
    region,
    address: addresses[index] ?? Abi.AddressLimit,
  }));
  for (const binding of result) {
    const { address, region } = binding;
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      address % Abi.WordBytes ||
      address + region.bytes > Abi.AddressLimit
    )
      return undefined;
    if (
      region.writable &&
      result.some(
        (other) =>
          other !== binding &&
          address < other.address + other.region.bytes &&
          other.address < address + region.bytes,
      )
    )
      return undefined;
  }
  return result;
}
export function prepareCompiledTransform(
  cpu: GuestCPU,
  transform: Transform,
): (host: KernelHost) => void {
  const { entry, program, name } = transform;
  if (
    readWord(cpu, entry.Address) !== entry.First ||
    readWord(cpu, entry.Address + Abi.WordBytes) !== entry.Second ||
    readWord(cpu, entry.End) !== entry.Epilogue
  )
    throw new Error(`${name} instructions do not match the verified profile.`);
  const plan = planFloatProgram({
    ...program,
    address: entry.Start,
    code: cpu.read(entry.Start, entry.End - entry.Start),
  });
  const kernel = compileFloatKernel(plan),
    buffer = new Uint8Array(kernel.memory.buffer);
  const execute = (): boolean => {
    const mapped = bindings(program.regions, transform.addresses());
    if (!mapped) return false;
    for (const { address, region } of mapped)
      buffer.set(cpu.read(address, region.bytes), region.offset);
    kernel.run();
    for (const { address, region } of mapped)
      if (region.writable)
        cpu.write(address, buffer.subarray(region.offset, region.offset + region.bytes));
    return true;
  };
  return (host) => {
    if (host.cpu !== cpu) throw new Error("Compiled kernel belongs to another guest CPU.");
    const fallback = host.heap.alloc(Abi.PageBytes, Abi.PageBytes);
    if (!fallback) throw new Error(`Unable to allocate the ${name} fallback.`);
    cpu.write(
      fallback,
      words(entry.First, entry.Second, Abi.Jump, entry.Address + Abi.PatchBytes + Abi.Thumb),
    );
    cpu.protect(fallback, Abi.PageBytes, Abi.ReadExecute);
    const target = host.gate(name, () => ({
      jump: execute() ? cpu.getReg(Abi.Return) : fallback + Abi.Thumb,
    }));
    cpu.write(entry.Address, words(Abi.Jump, target));
  };
}
