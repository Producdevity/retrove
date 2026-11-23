import type { GuestCPU } from "../../../../cpu/cpu";
import type { FloatRegion } from "../../../../cpu/thumb/float-state";
import type { KernelHost } from "../kernels";
import { prepareCompiledTransform, readWord } from "./compiled-transform";
const Abi = { WordBytes: 4, Stack: 13, AddressLimit: 0x1_0000_0000 };
export const Dct64Entry = {
  Address: 0x4b9810,
  First: 0xf1adb590,
  Second: 0xaf010440,
  Start: 0x4b982a,
  End: 0x4ba0b0,
  Epilogue: 0x82edf924,
  TablePointer: 0x1ad482c,
};
const Layout = {
  FirstOutput: 0x10000,
  SecondOutput: 0x11000,
  Input: 0x12000,
  Stack: 0x13c00,
  Table: 0x15000,
  Coefficients: 0x16000,
  StackBytes: 544,
  FirstOutputBytes: 1028,
  SecondOutputBytes: 964,
  InputBytes: 128,
  CoefficientTables: 5,
  CoefficientSpacing: 256,
  FirstCoefficientBytes: 64,
};
const Register = { FirstOutput: 0, SecondOutput: 1, Input: 2 };
const regions: readonly FloatRegion[] = [
  { address: Layout.FirstOutput, offset: 0, bytes: Layout.FirstOutputBytes, writable: true },
  {
    address: Layout.SecondOutput,
    offset: Layout.FirstOutputBytes,
    bytes: Layout.SecondOutputBytes,
    writable: true,
  },
  {
    address: Layout.Input,
    offset: Layout.FirstOutputBytes + Layout.SecondOutputBytes,
    bytes: Layout.InputBytes,
    writable: false,
  },
  ...coefficientRegions(),
];
function coefficientRegions(): FloatRegion[] {
  let offset = Layout.FirstOutputBytes + Layout.SecondOutputBytes + Layout.InputBytes;
  return Array.from({ length: Layout.CoefficientTables }, (_, index) => {
    const bytes = Layout.FirstCoefficientBytes >>> index;
    const region = {
      address: Layout.Coefficients + index * Layout.CoefficientSpacing,
      offset,
      bytes,
      writable: false,
    };
    offset += bytes;
    return region;
  });
}
export function prepareBioShockDct64(cpu: GuestCPU): (host: KernelHost) => void {
  return prepareCompiledTransform(cpu, {
    name: "BioShock MPEG DCT64",
    entry: Dct64Entry,
    program: {
      registers: new Map([
        [Register.FirstOutput, Layout.FirstOutput],
        [Register.SecondOutput, Layout.SecondOutput],
        [Register.Input, Layout.Input],
        [Abi.Stack, Layout.Stack],
      ]),
      pointers: new Map([
        [Dct64Entry.TablePointer, Layout.Table],
        ...Array.from({ length: Layout.CoefficientTables }, (_, index): [number, number] => [
          Layout.Table + index * Abi.WordBytes,
          Layout.Coefficients + index * Layout.CoefficientSpacing,
        ]),
      ]),
      regions,
      scratch: { address: Layout.Stack, bytes: Layout.StackBytes },
    },
    addresses: () => {
      const table = readWord(cpu, Dct64Entry.TablePointer);
      if (
        !table ||
        table % Abi.WordBytes ||
        table + Layout.CoefficientTables * Abi.WordBytes > Abi.AddressLimit
      )
        return undefined;
      return [
        cpu.getReg(Register.FirstOutput),
        cpu.getReg(Register.SecondOutput),
        cpu.getReg(Register.Input),
        ...Array.from({ length: Layout.CoefficientTables }, (_, index) =>
          readWord(cpu, table + index * Abi.WordBytes),
        ),
      ];
    },
  });
}
