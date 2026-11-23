import { WORD_BYTES } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
import {
  ImageAlpha,
  ImageComponents,
  rgbaImageMetadata,
  type ImageMetadata,
} from "./image-metadata";
import type { ImageObject, ImageSource, QuartzObjects } from "./quartz-objects";

const COLOR_MAXIMUM = 255;
const RGB_CHANNELS = 3;
const MAX_PIXELS = 0x4000000;
const COMPONENT_BITS = 8;
const BITS_PER_BYTE = 8;
const DECODE_ENTRIES = 2;
const Info = { AlphaMask: 31, FloatComponents: 256, OrderShift: 12, OrderMask: 7 } as const;
const ByteOrder = { Little16: 1, Little32: 2, Big16: 3, Big32: 4 } as const;
const ShortPixel = 2;
const WidePixel = 4;
const FIRST_ALPHA: readonly number[] = [
  ImageAlpha.PremultipliedFirst,
  ImageAlpha.First,
  ImageAlpha.NoneSkipFirst,
];
const ANY_ALPHA: readonly number[] = [
  ImageAlpha.PremultipliedLast,
  ImageAlpha.PremultipliedFirst,
  ImageAlpha.Last,
  ImageAlpha.First,
];
const PREMULTIPLIED: readonly number[] = [
  ImageAlpha.PremultipliedLast,
  ImageAlpha.PremultipliedFirst,
];
const Argument = {
  Width: 0,
  Height: 1,
  BitsPerComponent: 2,
  BitsPerPixel: 3,
  Stride: 4,
  Space: 5,
  Info: 6,
  Provider: 7,
  Decode: 8,
  Interpolate: 9,
} as const;

function decodeRgba(image: ImageObject, source: ImageSource, input: Uint8Array): Uint8ClampedArray {
  const { width, height, bytes, stride, alpha } = image;
  const { little, decode, components } = source;
  const rgba = new Uint8ClampedArray(width * height * ImageComponents.RGBA);
  const first = FIRST_ALPHA.includes(alpha);
  const hasAlpha = ANY_ALPHA.includes(alpha);
  const premultiplied = PREMULTIPLIED.includes(alpha);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * stride + x * bytes;
      const out = (y * width + x) * ImageComponents.RGBA;
      const channel = (index: number): number =>
        input[offset + (little ? bytes - 1 - index : index)] ?? 0;
      const a = hasAlpha ? channel(first ? 0 : bytes - 1) : COLOR_MAXIMUM;
      for (let index = 0; index < RGB_CHANNELS; index++) {
        const sample = components === 1 ? 0 : index;
        let value = channel(sample + Number(first));
        if (premultiplied) value = a ? Math.min(COLOR_MAXIMUM, (value * COLOR_MAXIMUM) / a) : 0;
        if (decode) {
          const low = decode[DECODE_ENTRIES * sample] ?? 0;
          const high = decode[DECODE_ENTRIES * sample + 1] ?? 0;
          value = low * COLOR_MAXIMUM + value * (high - low);
        }
        rgba[out + index] = value;
      }
      rgba[out + RGB_CHANNELS] = a;
    }
  }
  return rgba;
}

export type DecodedImage = ImageObject & { rgba: Uint8ClampedArray };
const hasPixels = (image: ImageObject): image is DecodedImage => image.rgba !== undefined;

/** The image with its RGBA pixels decoded from the provider, or null when `pointer` is not one. */
export function quartzPixels(objects: QuartzObjects, pointer: number): DecodedImage | null {
  const image = objects.image(pointer);
  if (!image) return null;
  if (!image.rgba && image.source) {
    const provider = objects.provider(image.source.provider);
    if (!provider) throw new Error("Quartz image provider was released");
    const data = provider.data;
    const address = objects.objc.funcs._CFDataGetBytePtr(() => data);
    const length = image.stride * (image.height - 1) + image.width * image.bytes;
    image.rgba = decodeRgba(image, image.source, objects.cpu.read(address, length));
  }
  return hasPixels(image) ? image : null;
}

export function createQuartzImage(
  objects: QuartzObjects,
  width: number,
  height: number,
  rgba: ArrayLike<number>,
): number {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * ImageComponents.RGBA) return 0;
  const copy = new Uint8ClampedArray(rgba);
  const space = objects.add({ kind: "space", components: ImageComponents.RGB });
  if (!space) return 0;
  const pointer = objects.add({
    kind: "image",
    ...rgbaImageMetadata(width, height, space),
    rgba: copy,
  });
  if (!pointer) {
    objects.objects.delete(space);
    objects.heap.free(space);
  }
  return pointer;
}

function supportedLayout(
  metadata: ImageMetadata,
  components: number,
  info: number,
  order: number,
): boolean {
  const { width, height, bytes, stride, alpha, bitsPerComponent } = metadata;
  if (!width || !height || !components || bitsPerComponent !== COMPONENT_BITS) return false;
  if (info & Info.FloatComponents || alpha > ImageAlpha.NoneSkipFirst) return false;
  if (bytes !== components + Number(alpha !== 0) || stride < width * bytes) return false;
  if (height * width > MAX_PIXELS || order > ByteOrder.Big32) return false;
  const short = order === ByteOrder.Little16 || order === ByteOrder.Big16;
  return !order || bytes === (short ? ShortPixel : WidePixel);
}

function readDecode(objects: QuartzObjects, pointer: number, components: number): number[] {
  const buffer = objects.cpu.read(pointer, components * DECODE_ENTRIES * WORD_BYTES);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return Array.from({ length: DECODE_ENTRIES * components }, (_, index) =>
    view.getFloat32(index * WORD_BYTES, true),
  );
}

export function imageFromProvider(objects: QuartzObjects, a: GuestArguments): number {
  const space = a(Argument.Space);
  const info = a(Argument.Info);
  const provider = a(Argument.Provider);
  const components = objects.space(space)?.components;
  const source = objects.provider(provider);
  const alpha = info & Info.AlphaMask;
  const order = (info >>> Info.OrderShift) & Info.OrderMask;
  const metadata: ImageMetadata = {
    width: a(Argument.Width),
    height: a(Argument.Height),
    bytes: a(Argument.BitsPerPixel) / BITS_PER_BYTE,
    stride: a(Argument.Stride),
    bitsPerComponent: a(Argument.BitsPerComponent),
    alpha,
    bitmapInfo: info,
    space,
    interpolate: Boolean(a(Argument.Interpolate)),
  };
  if (!source || !components || !supportedLayout(metadata, components, info, order)) return 0;
  const { funcs } = objects.objc;
  const needed = metadata.stride * (metadata.height - 1) + metadata.width * metadata.bytes;
  if (needed > funcs._CFDataGetLength(() => source.data)) return 0;
  const decodePointer = a(Argument.Decode);
  const decode = decodePointer ? readDecode(objects, decodePointer, components) : undefined;
  const pointer = objects.add({
    kind: "image",
    ...metadata,
    source: {
      provider,
      components,
      decode,
      little: order === ByteOrder.Little16 || order === ByteOrder.Little32,
    },
  });
  if (pointer) {
    objects.retain(provider);
    objects.retain(space);
  }
  return pointer;
}
