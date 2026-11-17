import { ImageAlpha, ImageComponents } from "./image-metadata";

export const BITMAP_COMPONENT_BITS = 8;
export const BITMAP_BYTE_MAX = 255;
const MAX_BITMAP_BYTES = 268435456;
const BitmapFlag = { AlphaMask: 0x1f, OrderMask: 0x7000, Little32: 0x2000, Big32: 0x4000 } as const;
const ALLOWED_FLAGS = BitmapFlag.AlphaMask | BitmapFlag.OrderMask;
const Channel = { Red: 0, Green: 1, Blue: 2, Alpha: 3 } as const;
/** Rec. 601 luma weights for drawing into DeviceGray contexts. */
const Luma = { Red: 0.299, Green: 0.587, Blue: 0.114 } as const;
export interface BitmapLayout {
  width: number;
  height: number;
  stride: number;
  bytes: number;
  length: number;
  bitmapInfo: number;
  alpha: number;
  first: boolean;
  little: boolean;
  premultiplied: boolean;
  opaque: boolean;
  /** One DeviceGray byte per pixel without alpha (Texture2D's text and A8 textures). */
  gray: boolean;
}
export function bitmapLayout(
  width: number,
  height: number,
  bits: number,
  stride: number,
  components: number,
  info: number,
): BitmapLayout | undefined {
  const alpha = info & BitmapFlag.AlphaMask,
    order = info & BitmapFlag.OrderMask;
  const alphaOnly = components === 0 && alpha === ImageAlpha.Only;
  const gray = components === ImageComponents.Gray && alpha === ImageAlpha.None && order === 0;
  const premultiplied =
    alpha === ImageAlpha.PremultipliedFirst || alpha === ImageAlpha.PremultipliedLast;
  const opaque = alpha === ImageAlpha.NoneSkipFirst || alpha === ImageAlpha.NoneSkipLast;
  if (
    bits !== BITMAP_COMPONENT_BITS ||
    info & ~ALLOWED_FLAGS ||
    (!alphaOnly && !gray && (components !== ImageComponents.RGB || (!premultiplied && !opaque))) ||
    (order !== 0 && order !== BitmapFlag.Little32 && order !== BitmapFlag.Big32) ||
    (alphaOnly && order !== 0)
  )
    return undefined;
  const bytes = alphaOnly || gray ? 1 : ImageComponents.RGBA;
  stride ||= width * bytes;
  const length = stride * height;
  if (
    ![width, height, stride, length].every(Number.isSafeInteger) ||
    width <= 0 ||
    height <= 0 ||
    stride < width * bytes ||
    length > MAX_BITMAP_BYTES
  )
    return undefined;
  return {
    width,
    height,
    stride,
    bytes,
    length,
    bitmapInfo: info,
    alpha,
    premultiplied,
    opaque: opaque || gray,
    gray,
    little: order === BitmapFlag.Little32,
    first: alpha === ImageAlpha.PremultipliedFirst || alpha === ImageAlpha.NoneSkipFirst,
  };
}
function offset(layout: BitmapLayout, row: number, column: number, channel: number): number {
  return (
    row * layout.stride +
    column * layout.bytes +
    (layout.little ? layout.bytes - 1 - channel : channel)
  );
}
export function unpackBitmap(layout: BitmapLayout, input: Uint8Array): Uint8ClampedArray {
  if (input.length < layout.length) throw new Error("Truncated bitmap backing storage.");
  const rgba = new Uint8ClampedArray(layout.width * layout.height * ImageComponents.RGBA);
  for (let y = 0; y < layout.height; y++)
    for (let x = 0; x < layout.width; x++) {
      const out = (y * layout.width + x) * ImageComponents.RGBA;
      if (layout.gray) {
        const value = input[offset(layout, y, x, 0)] ?? 0;
        rgba.fill(value, out, out + Channel.Alpha);
        rgba[out + Channel.Alpha] = BITMAP_BYTE_MAX;
        continue;
      }
      const alphaIndex = layout.first ? 0 : layout.bytes - 1;
      const alpha = layout.opaque
        ? BITMAP_BYTE_MAX
        : (input[offset(layout, y, x, alphaIndex)] ?? 0);
      rgba[out + Channel.Alpha] = alpha;
      for (let c = Channel.Red; c <= Channel.Blue; c++) {
        const value =
          layout.bytes === 1
            ? BITMAP_BYTE_MAX
            : (input[offset(layout, y, x, c + Number(layout.first))] ?? 0);
        rgba[out + c] = layout.premultiplied
          ? alpha
            ? (value * BITMAP_BYTE_MAX) / alpha
            : 0
          : value;
      }
    }
  return rgba;
}
export function packBitmap(
  layout: BitmapLayout,
  rgba: Uint8ClampedArray,
  target: Uint8Array,
  previous?: Uint8ClampedArray,
): void {
  if (
    target.length < layout.length ||
    rgba.length !== layout.width * layout.height * ImageComponents.RGBA ||
    (previous !== undefined && previous.length !== rgba.length)
  )
    throw new Error("Invalid bitmap pixel storage.");
  for (let y = 0; y < layout.height; y++)
    for (let x = 0; x < layout.width; x++) {
      const source = (y * layout.width + x) * ImageComponents.RGBA;
      if (
        previous &&
        [Channel.Red, Channel.Green, Channel.Blue, Channel.Alpha].every(
          (c) => previous[source + c] === rgba[source + c],
        )
      )
        continue;
      const alpha = rgba[source + Channel.Alpha] ?? 0;
      if (layout.gray) {
        const luma =
          Luma.Red * (rgba[source + Channel.Red] ?? 0) +
          Luma.Green * (rgba[source + Channel.Green] ?? 0) +
          Luma.Blue * (rgba[source + Channel.Blue] ?? 0);
        target[offset(layout, y, x, 0)] = Math.round((luma * alpha) / BITMAP_BYTE_MAX);
        continue;
      }
      const alphaIndex = layout.first ? 0 : layout.bytes - 1;
      target[offset(layout, y, x, alphaIndex)] = alpha;
      if (layout.bytes === 1) continue;
      for (let c = Channel.Red; c <= Channel.Blue; c++) {
        const value = rgba[source + c] ?? 0;
        target[offset(layout, y, x, c + Number(layout.first))] = Math.round(
          layout.premultiplied ? (value * alpha) / BITMAP_BYTE_MAX : value,
        );
      }
    }
}
