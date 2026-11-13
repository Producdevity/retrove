import type { GuestCPU } from "../../../../../../web/cpu.mjs";
import { planFloatProgram } from "../../../../cpu/thumb/float-program";
import { compileFloatKernel } from "../../../../cpu/wasm/float-kernel";
import type { FloatRegion } from "../../../../cpu/thumb/float-state";
import type { KernelHost } from "../kernels";
const Abi = {
  WordBytes: 4,
  PatchBytes: 8,
  PageBytes: 4096,
  ReadExecute: 5,
  AddressLimit: 0x1_0000_0000,
  Stack: 13,
  Return: 14,
  Thumb: 1,
  Jump: 0xf000f8df,
};
export const Dct36Entry = {
  Address: 0x4be984,
  First: 0xf1adb590,
  Second: 0xaf010440,
  Start: 0x4be99c,
  End: 0x4bf020,
  Epilogue: 0x82edf924,
  Constants: 0x23450dc,
  ConstantBytes: 80,
};
const Layout = {
  Input: 0x10000,
  Previous: 0x11000,
  Next: 0x12000,
  Window: 0x13000,
  Output: 0x14000,
  Frame: 0x18100,
  Stack: 0x18000,
  StackBytes: 160,
  Argument: 8,
  SamplesBytes: 72,
  WindowBytes: 144,
  OutputBytes: 2180,
};
const Register = { Input: 0, Previous: 1, Next: 2, Window: 3, Frame: 7 };
const regions: readonly FloatRegion[] = [
  { address: Layout.Input, offset: 0, bytes: Layout.SamplesBytes, writable: true },
  { address: Layout.Previous, offset: 72, bytes: Layout.SamplesBytes, writable: false },
  { address: Layout.Next, offset: 144, bytes: Layout.SamplesBytes, writable: true },
  { address: Layout.Window, offset: 216, bytes: Layout.WindowBytes, writable: false },
  { address: Layout.Output, offset: 360, bytes: Layout.OutputBytes, writable: true },
  { address: Dct36Entry.Constants, offset: 2540, bytes: Dct36Entry.ConstantBytes, writable: false },
];
function word(cpu: GuestCPU, address: number): number {
  const bytes = cpu.read(address, Abi.WordBytes);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * Abi.WordBytes),
    view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * Abi.WordBytes, value, true));
  return bytes;
}
interface Binding {
  readonly address: number;
  readonly region: FloatRegion;
}
function bindings(cpu: GuestCPU): Binding[] | undefined {
  const addresses = [
    cpu.getReg(Register.Input),
    cpu.getReg(Register.Previous),
    cpu.getReg(Register.Next),
    cpu.getReg(Register.Window),
    word(cpu, cpu.getReg(Abi.Stack)),
    Dct36Entry.Constants,
  ];
  const result = regions.map((region, index) => ({
    region,
    address: addresses[index] ?? Abi.AddressLimit,
  }));
  for (const binding of result) {
    const { address, region } = binding;
    if (address % Abi.WordBytes || address + region.bytes > Abi.AddressLimit) return undefined;
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
export function prepareBioShockDct36(cpu: GuestCPU): (host: KernelHost) => void {
  if (
    word(cpu, Dct36Entry.Address) !== Dct36Entry.First ||
    word(cpu, Dct36Entry.Address + Abi.WordBytes) !== Dct36Entry.Second ||
    word(cpu, Dct36Entry.End) !== Dct36Entry.Epilogue
  )
    throw new Error("BioShock DCT instructions do not match the verified profile.");
  const plan = planFloatProgram({
    address: Dct36Entry.Start,
    code: cpu.read(Dct36Entry.Start, Dct36Entry.End - Dct36Entry.Start),
    registers: new Map([
      [Register.Input, Layout.Input],
      [Register.Previous, Layout.Previous],
      [Register.Next, Layout.Next],
      [Register.Window, Layout.Window],
      [Register.Frame, Layout.Frame],
      [Abi.Stack, Layout.Stack],
    ]),
    pointers: new Map([[Layout.Frame + Layout.Argument, Layout.Output]]),
    regions,
    scratch: { address: Layout.Stack, bytes: Layout.StackBytes },
  });
  const kernel = compileFloatKernel(plan),
    buffer = new Uint8Array(kernel.memory.buffer);
  const execute = (): boolean => {
    const mapped = bindings(cpu);
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
    if (!fallback) throw new Error("Unable to allocate the BioShock DCT fallback.");
    cpu.write(
      fallback,
      words(
        Dct36Entry.First,
        Dct36Entry.Second,
        Abi.Jump,
        Dct36Entry.Address + Abi.PatchBytes + Abi.Thumb,
      ),
    );
    cpu.protect(fallback, Abi.PageBytes, Abi.ReadExecute);
    const target = host.gate("BioShock MPEG DCT36", () => ({
      jump: execute() ? cpu.getReg(Abi.Return) : fallback + Abi.Thumb,
    }));
    cpu.write(Dct36Entry.Address, words(Abi.Jump, target));
  };
}
