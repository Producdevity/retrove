import type { GuestArguments } from "../../ios/objc/host";
export const ImageAlpha = {
  None: 0,
  PremultipliedLast: 1,
  PremultipliedFirst: 2,
  Last: 3,
  First: 4,
  NoneSkipLast: 5,
  NoneSkipFirst: 6,
  Only: 7,
} as const;
export const ImageComponents = { Gray: 1, RGB: 3, RGBA: 4 } as const;
const BITS_PER_BYTE = 8;
export interface ImageMetadata {
  width: number;
  height: number;
  bytes: number;
  stride: number;
  bitsPerComponent: number;
  alpha: number;
  bitmapInfo: number;
  space: number;
  interpolate: boolean;
}
export function rgbaImageMetadata(width: number, height: number, space: number): ImageMetadata {
  return {
    width,
    height,
    bytes: ImageComponents.RGBA,
    stride: width * ImageComponents.RGBA,
    bitsPerComponent: BITS_PER_BYTE,
    alpha: ImageAlpha.Last,
    bitmapInfo: ImageAlpha.Last,
    space,
    interpolate: true,
  };
}
interface MetadataHost {
  image(pointer: number): ImageMetadata | undefined;
}
export function imageMetadataImports(
  host: MetadataHost,
): Record<string, (args: GuestArguments) => number> {
  const readers: Record<string, (image: ImageMetadata) => number> = {
    _CGImageGetWidth: (image) => image.width,
    _CGImageGetHeight: (image) => image.height,
    _CGImageGetAlphaInfo: (image) => image.alpha,
    _CGImageGetBitsPerComponent: (image) => image.bitsPerComponent,
    _CGImageGetBitsPerPixel: (image) => image.bytes * BITS_PER_BYTE,
    _CGImageGetBytesPerRow: (image) => image.stride,
    _CGImageGetBitmapInfo: (image) => image.bitmapInfo,
    _CGImageGetColorSpace: (image) => image.space,
    _CGImageGetShouldInterpolate: (image) => Number(image.interpolate),
  };
  return Object.fromEntries(
    Object.entries(readers).map(([name, read]) => [
      name,
      (args: GuestArguments) => {
        const image = host.image(args(0));
        return image ? read(image) : 0;
      },
    ]),
  );
}
