import type { GuestCPU } from "../../../../../../web/cpu.mjs";
import type { FloatRegion } from "../../../../cpu/thumb/float-state";
import type { KernelHost } from "../kernels";
import { prepareCompiledTransform, readWord } from "./compiled-transform";
const Abi = { Stack: 13 };
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
export function prepareBioShockDct36(cpu: GuestCPU): (host: KernelHost) => void {
  return prepareCompiledTransform(cpu, {
    name: "BioShock MPEG DCT36",
    entry: Dct36Entry,
    program: {
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
    },
    addresses: () => [
      cpu.getReg(Register.Input),
      cpu.getReg(Register.Previous),
      cpu.getReg(Register.Next),
      cpu.getReg(Register.Window),
      readWord(cpu, cpu.getReg(Abi.Stack)),
      Dct36Entry.Constants,
    ],
  });
}
