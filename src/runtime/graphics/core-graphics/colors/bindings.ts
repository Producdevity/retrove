import { floatBits, floatFromBits } from "../../../ios/abi/scalars";
import type { GuestArguments } from "../../../ios/objc/host";
import type { Colors } from "./model";
import { ColorName, COLOR_COMPONENTS } from "./model";
export const ColorSymbols = {
  _kCGColorBlack: ColorName.Black,
  _kCGColorClear: ColorName.Clear,
  _kCGColorWhite: ColorName.White,
} as const;
interface ColorHost {
  readonly colors: Colors;
  text(pointer: number): string;
}
export function colorImports(host: ColorHost) {
  const colors = host.colors;
  return {
    _CGColorCreate: (args: GuestArguments) => colors.fromMemory(args(0), args(1)),
    _CGColorCreateGenericGray: (args: GuestArguments) =>
      colors.generic([floatFromBits(args(0)), floatFromBits(args(1))]),
    _CGColorCreateGenericRGB: (args: GuestArguments) =>
      colors.generic(
        Array.from({ length: COLOR_COMPONENTS }, (_, index) => floatFromBits(args(index))),
      ),
    _CGColorRetain: (args: GuestArguments) => colors.retain(args(0)),
    _CGColorRelease: (args: GuestArguments) => colors.release(args(0)),
    _CGColorCreateCopy: (args: GuestArguments) => colors.retain(args(0)),
    _CGColorCreateCopyWithAlpha: (args: GuestArguments) =>
      colors.copyWithAlpha(args(0), floatFromBits(args(1))),
    _CGColorGetAlpha: (args: GuestArguments) => floatBits(colors.alpha(args(0))),
    _CGColorGetComponents: (args: GuestArguments) => colors.get(args(0))?.buffer ?? 0,
    _CGColorGetNumberOfComponents: (args: GuestArguments) =>
      colors.get(args(0))?.components.length ?? 0,
    _CGColorGetColorSpace: (args: GuestArguments) => colors.get(args(0))?.space ?? 0,
    _CGColorGetPattern: () => 0,
    _CGColorEqualToColor: (args: GuestArguments) => Number(colors.equal(args(0), args(1))),
    _CGColorGetConstantColor: (args: GuestArguments) => colors.constant(host.text(args(0))),
  };
}
