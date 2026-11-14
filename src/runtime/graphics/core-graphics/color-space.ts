import type { GuestArguments } from "../../ios/objc/host";
export const ColorSpaceModel = { Unknown: -1, Monochrome: 0, RGB: 1 } as const;
export const ColorComponents = { Monochrome: 1, RGB: 3 } as const;
interface ColorSpaceHost {
  components(pointer: number): number | undefined;
}
export function colorSpaceImports(host: ColorSpaceHost) {
  return {
    _CGColorSpaceGetModel: (args: GuestArguments) => {
      switch (host.components(args(0))) {
        case ColorComponents.Monochrome:
          return ColorSpaceModel.Monochrome;
        case ColorComponents.RGB:
          return ColorSpaceModel.RGB;
        default:
          return ColorSpaceModel.Unknown;
      }
    },
    _CGColorSpaceGetNumberOfComponents: (args: GuestArguments) => host.components(args(0)) ?? 0,
  };
}
