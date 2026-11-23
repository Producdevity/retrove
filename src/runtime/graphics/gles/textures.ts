import { write32 } from "../../memory/guest-memory";
import { hasBlit } from "../gl-parameters";
import { TEXEL_BYTES } from "../gpu-memory";
import { words3, words7, words8, words9, type Words9 } from "./arguments";
import { Gles, MAX_GUEST_BYTES } from "./constants";
import type { GlesContext } from "./context";
import { numeric, sourceBuffer, writeNumber, type PixelArray, type PixelType } from "./data";
import { installCompressed } from "./compressed";

const HEX_RADIX = 16;
const Size = { Byte: 1, Short: 2, Word: 4 } as const;
const TYPE_BYTES = new Map<number, number>([
  [Gles.Byte, Size.Byte],
  [Gles.UnsignedByte, Size.Byte],
  [Gles.Short, Size.Short],
  [Gles.UnsignedShort, Size.Short],
  [Gles.UnsignedInt, Size.Word],
  [Gles.Float, Size.Word],
]);
const Channels = { One: 1, Two: 2, Three: 3, Four: 4 } as const;
const COMPONENTS = new Map<number, number>([
  [Gles.Alpha, Channels.One],
  [Gles.Luminance, Channels.One],
  [Gles.LuminanceAlpha, Channels.Two],
  [Gles.Rgb, Channels.Three],
  [Gles.Rgba, Channels.Four],
  [Gles.Bgra, Channels.Four],
  [Gles.DepthComponent, Channels.One],
]);
const PACKED_TYPES = new Set<number>([
  Gles.UnsignedShort565,
  Gles.UnsignedShort4444,
  Gles.UnsignedShort5551,
]);

function elementType(type: number, width: number): PixelType {
  if (type === Gles.Float) return Float32Array;
  if (width === Size.Word) return Uint32Array;
  return width === Size.Short ? Uint16Array : Uint8Array;
}

/** A pixel array sized for a w x h block: filled from guest memory at `pointer` when given. */
export function pixels(
  host: GlesContext,
  size: readonly [number, number],
  format: number,
  type: number,
  alignment: number,
  pointer?: number,
): PixelArray {
  const [w, h] = size;
  const components = COMPONENTS.get(format);
  const packed = PACKED_TYPES.has(type);
  const width =
    packed || type === Gles.HalfFloat || type === Gles.HalfFloatOes
      ? Size.Short
      : TYPE_BYTES.get(type);
  if (!components || !width)
    throw new Error(
      "Unsupported GLES pixel format/type: 0x" +
        format.toString(HEX_RADIX) +
        "/0x" +
        type.toString(HEX_RADIX),
    );
  const row = w * width * (packed ? 1 : components);
  const bytes = h ? (h - 1) * Math.ceil(row / alignment) * alignment + row : 0;
  const Type = elementType(type, width);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_GUEST_BYTES)
    throw new Error("Invalid GLES pixel data length");
  return pointer === undefined
    ? new Type(bytes / width)
    : sourceBuffer(host.cpu, pointer, bytes, Type);
}

function swapRedBlue(data: PixelArray, width: number, height: number, alignment: number): void {
  const stride = Math.ceil((width * Size.Word) / alignment) * alignment;
  for (let y = 0; y < height; y++)
    for (let i = y * stride; i < y * stride + width * Size.Word; i += Size.Word) {
      const blue = data[i] ?? 0;
      data[i] = data[i + Size.Short] ?? 0;
      data[i + Size.Short] = blue;
    }
}

function uploadPixels(host: GlesContext, words: Words9, sub: boolean): void {
  const [target, level, third, fourth, fifth, sixth, guestFormat, guestType, pointer] = words;
  const width = sub ? fifth : fourth;
  const height = sub ? sixth : fifth;
  const bgra = guestFormat === Gles.Bgra;
  let internal = third;
  let format = guestFormat;
  let type = guestType;
  if (bgra && type !== Gles.UnsignedByte && type !== Gles.UnsignedInt8888Reverse) {
    host.setError(Gles.InvalidEnum);
    return;
  }
  if (bgra) {
    format = Gles.Rgba;
    if (!sub && internal === Gles.Bgra) internal = Gles.Rgba;
    type = Gles.UnsignedByte;
  }
  if (type === Gles.HalfFloatOes) {
    if (hasBlit(host.gl())) type = Gles.HalfFloat;
    else if (!host.gl().getExtension("OES_texture_half_float")) {
      host.setError(Gles.InvalidEnum);
      return;
    }
  }
  if (!sub && type === Gles.HalfFloat && internal === Gles.Rgba) internal = Gles.Rgba16F;
  if (!sub && type === Gles.HalfFloat && internal === Gles.Rgb) internal = Gles.Rgb16F;
  const data = pointer
    ? pixels(host, [width, height], format, type, host.unpackAlign, pointer)
    : null;
  if (data && bgra) swapRedBlue(data, width, height, host.unpackAlign);
  const gl = host.gl();
  if (sub) gl.texSubImage2D(target, level, internal, fourth, fifth, sixth, format, type, data);
  else gl.texImage2D(target, level, internal, fourth, fifth, sixth, format, type, data);
  if (!sub) host.textureLevel(target, level, width * height * TEXEL_BYTES);
}

function installCopies(host: GlesContext): void {
  host.bind("CopyTexImage2D", (a) => {
    const [target, level, format, x, y, width, height, border] = words8(a);
    host.gl().copyTexImage2D(target, level, format, x, y, width, height, border);
    host.textureLevel(target, level, width * height * TEXEL_BYTES);
  });
  host.bind("CopyTexSubImage2D", (a) => {
    const [target, level, xOffset, yOffset, x, y, width, height] = words8(a);
    host.gl().copyTexSubImage2D(target, level, xOffset, yOffset, x, y, width, height);
  });
  host.bind("GetTexParameteriv", (a) => {
    const [target, name, pointer] = words3(a);
    write32(host.cpu, pointer, numeric(host.gl().getTexParameter(target, name)));
  });
  host.bind("GetTexParameterfv", (a) => {
    const [target, name, pointer] = words3(a);
    writeNumber(host.cpu, pointer, numeric(host.gl().getTexParameter(target, name)), "float");
  });
}

/** Texture uploads, readback, copies and parameter queries. */
export function installTextures(host: GlesContext): void {
  host.bind("TexImage2D", (a) => uploadPixels(host, words9(a), false));
  host.bind("TexSubImage2D", (a) => uploadPixels(host, words9(a), true));
  host.bind("ReadPixels", (a) => {
    const [x, y, width, height, format, type, pointer] = words7(a);
    const data = pixels(host, [width, height], format, type, host.packAlign);
    host.gl().readPixels(x, y, width, height, format, type, data);
    host.cpu.write(pointer, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  });
  installCopies(host);
  installCompressed(host);
}
