import type { GuestCPU } from "../../../../../../web/cpu.mjs";
import { planFloatProgram } from "../../../../cpu/thumb/float-program";
import { compileFloatKernel } from "../../../../cpu/wasm/float-kernel";
import type { KernelHost } from "../kernels";
const Abi = {
  WordBytes: 4,
  PatchBytes: 8,
  PageBytes: 4096,
  ReadExecute: 5,
  AddressLimit: 0x1_0000_0000,
  Thumb: 1,
  Jump: 0xf000f8df,
};
export const AntialiasEntry = {
  Address: 0x4be7b0,
  Load: 0x1a08ed11,
  Decrement: 0x0901f1b9,
  End: 0x4be974,
  Advance: 0x0148f101,
  Return: 0x4be980,
  ReturnWord: 0xbf004770,
};
const Register = { Cursor: 1, Sine: 2, Cosine: 3, Count: 9 };
const Layout = {
  Samples: 0x10000,
  Coefficients: 0x20000,
  Scratch: 0x30000,
  WindowBytes: 64,
  TableBytes: 32,
  CursorOffset: 60,
  BandBytes: 72,
  MaximumBoundaries: 31,
};
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
function overlap(address: number, size: number, other: number, length: number): boolean {
  return address < other + length && other < address + size;
}
function process(cpu: GuestCPU, buffer: Uint8Array, run: () => void): boolean {
  const count = cpu.getReg(Register.Count),
    cursor = cpu.getReg(Register.Cursor),
    sine = cpu.getReg(Register.Sine),
    cosine = cpu.getReg(Register.Cosine);
  if (!count || count > Layout.MaximumBoundaries || cursor < Layout.CursorOffset) return false;
  const start = cursor - Layout.CursorOffset,
    length = (count - 1) * Layout.BandBytes + Layout.WindowBytes;
  if (
    start % Abi.WordBytes ||
    cursor + count * Layout.BandBytes >= Abi.AddressLimit ||
    [sine, cosine].some(
      (address) =>
        address % Abi.WordBytes ||
        address + Layout.TableBytes > Abi.AddressLimit ||
        overlap(start, length, address, Layout.TableBytes),
    )
  )
    return false;
  const samples = cpu.read(start, length);
  buffer.set(cpu.read(sine, Layout.TableBytes), Layout.WindowBytes);
  buffer.set(cpu.read(cosine, Layout.TableBytes), Layout.WindowBytes + Layout.TableBytes);
  for (let band = 0; band < count; band++) {
    const at = band * Layout.BandBytes;
    buffer.set(samples.subarray(at, at + Layout.WindowBytes));
    run();
    samples.set(buffer.subarray(0, Layout.WindowBytes), at);
  }
  cpu.write(start, samples);
  cpu.setReg(Register.Cursor, cursor + count * Layout.BandBytes);
  cpu.setReg(Register.Count, 0);
  return true;
}
export function prepareBioShockAntialias(cpu: GuestCPU): (host: KernelHost) => void {
  if (
    word(cpu, AntialiasEntry.Address) !== AntialiasEntry.Load ||
    word(cpu, AntialiasEntry.Address + Abi.WordBytes) !== AntialiasEntry.Decrement ||
    word(cpu, AntialiasEntry.End) !== AntialiasEntry.Advance ||
    word(cpu, AntialiasEntry.Return) !== AntialiasEntry.ReturnWord
  )
    throw new Error("BioShock alias-reduction instructions do not match the verified profile.");
  const original = cpu.read(AntialiasEntry.Address, AntialiasEntry.End - AntialiasEntry.Address),
    code = new Uint8Array(original.length - Abi.WordBytes);
  code.set(original.subarray(0, Abi.WordBytes));
  code.set(original.subarray(Abi.PatchBytes), Abi.WordBytes);
  const plan = planFloatProgram({
    address: AntialiasEntry.Address,
    code,
    registers: new Map([
      [Register.Cursor, Layout.Samples + Layout.CursorOffset],
      [Register.Sine, Layout.Coefficients],
      [Register.Cosine, Layout.Coefficients + Layout.TableBytes],
    ]),
    pointers: new Map(),
    regions: [
      { address: Layout.Samples, offset: 0, bytes: Layout.WindowBytes, writable: true },
      {
        address: Layout.Coefficients,
        offset: Layout.WindowBytes,
        bytes: Layout.TableBytes + Layout.TableBytes,
        writable: false,
      },
    ],
    scratch: { address: Layout.Scratch, bytes: 0 },
  });
  const kernel = compileFloatKernel(plan),
    buffer = new Uint8Array(kernel.memory.buffer);
  return (host) => {
    if (host.cpu !== cpu) throw new Error("Compiled kernel belongs to another guest CPU.");
    const fallback = host.heap.alloc(Abi.PageBytes, Abi.PageBytes);
    if (!fallback) throw new Error("Unable to allocate the BioShock alias-reduction fallback.");
    cpu.write(
      fallback,
      words(
        AntialiasEntry.Load,
        AntialiasEntry.Decrement,
        Abi.Jump,
        AntialiasEntry.Address + Abi.PatchBytes + Abi.Thumb,
      ),
    );
    cpu.protect(fallback, Abi.PageBytes, Abi.ReadExecute);
    const target = host.gate("BioShock MPEG antialias", () => ({
      jump: process(cpu, buffer, kernel.run)
        ? AntialiasEntry.Return + Abi.Thumb
        : fallback + Abi.Thumb,
    }));
    cpu.write(AntialiasEntry.Address, words(Abi.Jump, target));
  };
}
