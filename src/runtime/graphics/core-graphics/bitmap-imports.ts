import { affineArguments } from "./affine";
import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import { BitmapContext, drawRasterImage } from "./bitmap-context";
import type { BitmapMemory, RasterContext, RasterImage } from "./bitmap-context";
import { BITMAP_COMPONENT_BITS, bitmapLayout } from "./bitmap-format";
import { ImageComponents } from "./image-metadata";
const BITS_PER_BYTE = 8;
const BitmapArgument = {
  Data: 0,
  Width: 1,
  Height: 2,
  Bits: 3,
  Stride: 4,
  Space: 5,
  Info: 6,
} as const;
const DrawArgument = { Context: 0, X: 1, Y: 2, Width: 3, Height: 4, Image: 5 } as const;
const Interpolation = { Default: 0, None: 1, Low: 2, High: 3, Medium: 4 } as const;
interface DrawingContext {
  canvas: RasterContext;
  bitmap?: BitmapContext;
}
interface BitmapHost extends BitmapMemory {
  allocate(length: number): number;
  components(space: number): number | undefined;
  create(bitmap: BitmapContext): number;
  context(pointer: number): DrawingContext | undefined;
  image(pointer: number): RasterImage | undefined;
  snapshot(bitmap: BitmapContext): number;
}
function createBitmap(host: BitmapHost, args: GuestArguments): number {
  const space = args(BitmapArgument.Space),
    components = space ? host.components(space) : 0;
  if (components === undefined) return 0;
  const layout = bitmapLayout(
    args(BitmapArgument.Width),
    args(BitmapArgument.Height),
    args(BitmapArgument.Bits),
    args(BitmapArgument.Stride),
    components,
    args(BitmapArgument.Info),
  );
  if (!layout) return 0;
  const supplied = args(BitmapArgument.Data),
    data = supplied || host.allocate(layout.length);
  if (!data) return 0;
  try {
    const bitmap = new BitmapContext(layout, data, !supplied, space, host);
    const pointer = host.create(bitmap);
    if (!pointer) bitmap.close();
    return pointer;
  } catch (error) {
    if (!supplied) host.free(data);
    throw error;
  }
}
function bitmapReaders(host: BitmapHost): Record<string, (args: GuestArguments) => number> {
  const readers: Record<string, (bitmap: BitmapContext) => number> = {
    _CGBitmapContextGetData: (b) => b.data,
    _CGBitmapContextGetWidth: (b) => b.layout.width,
    _CGBitmapContextGetHeight: (b) => b.layout.height,
    _CGBitmapContextGetBitsPerComponent: () => BITMAP_COMPONENT_BITS,
    _CGBitmapContextGetBitsPerPixel: (b) => b.layout.bytes * BITS_PER_BYTE,
    _CGBitmapContextGetBytesPerRow: (b) => b.layout.stride,
    _CGBitmapContextGetColorSpace: (b) => b.space,
    _CGBitmapContextGetAlphaInfo: (b) => b.layout.alpha,
    _CGBitmapContextGetBitmapInfo: (b) => b.layout.bitmapInfo,
  };
  return Object.fromEntries(
    Object.entries(readers).map(([name, read]) => [
      name,
      (a: GuestArguments) => {
        const bitmap = host.context(a(0))?.bitmap;
        return bitmap ? read(bitmap) : 0;
      },
    ]),
  );
}
export function bitmapImports(
  host: BitmapHost,
): Record<string, (args: GuestArguments) => number | void> {
  return {
    ...bitmapReaders(host),
    _CGBitmapContextCreate: (a) => createBitmap(host, a),
    _CGBitmapContextCreateImage: (a) => {
      const bitmap = host.context(a(0))?.bitmap;
      if (!bitmap) return 0;
      bitmap.refresh();
      return host.snapshot(bitmap);
    },
    _CGContextTranslateCTM: (a) =>
      host.context(a(0))?.canvas.translate(floatFromBits(a(1)), floatFromBits(a(DrawArgument.Y))),
    _CGContextConcatCTM: (a) => host.context(a(0))?.canvas.transform(...affineArguments(a, 1)),
    _CGContextClearRect: (a) => {
      const context = host.context(a(DrawArgument.Context));
      if (!context) return;
      context.bitmap?.refresh();
      context.canvas.clearRect(
        floatFromBits(a(DrawArgument.X)),
        floatFromBits(a(DrawArgument.Y)),
        floatFromBits(a(DrawArgument.Width)),
        floatFromBits(a(DrawArgument.Height)),
      );
      context.bitmap?.commit();
    },
    _CGContextDrawImage: (a) => {
      const context = host.context(a(DrawArgument.Context)),
        image = host.image(a(DrawArgument.Image));
      if (!context || !image) return;
      context.bitmap?.refresh();
      drawRasterImage(
        context.canvas,
        image,
        floatFromBits(a(DrawArgument.X)),
        floatFromBits(a(DrawArgument.Y)),
        floatFromBits(a(DrawArgument.Width)),
        floatFromBits(a(DrawArgument.Height)),
      );
      context.bitmap?.commit();
    },
    _CGContextSetInterpolationQuality: (a) => {
      const canvas = host.context(a(0))?.canvas,
        quality = a(1);
      if (!canvas || !Object.values<number>(Interpolation).includes(quality)) return;
      canvas.imageSmoothingEnabled = quality !== Interpolation.None;
      canvas.imageSmoothingQuality =
        quality === Interpolation.High
          ? "high"
          : quality === Interpolation.Medium
            ? "medium"
            : "low";
    },
  };
}
export function bitmapImageMetadata(bitmap: BitmapContext): Record<string, number | boolean> {
  const layout = bitmap.layout;
  return {
    ...layout,
    bitsPerComponent: BITMAP_COMPONENT_BITS,
    space: bitmap.space,
    interpolate: true,
    components: layout.bytes === 1 ? 0 : ImageComponents.RGB,
  };
}
