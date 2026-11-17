import createDecoder, { type TextureDecoder } from "../../../web/vendor/texture2ddecoder.mjs";

const Format = { RGB4: 0x8c00, RGB2: 0x8c01, RGBA4: 0x8c02, RGBA2: 0x8c03 } as const;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 16_777_216;
const MIN_WIDTH_TWO_BIT = 16;
const MIN_BLOCK = 8;
const RGBA_BYTES = 4;
const OPAQUE = 255;
const PixelsPerByte = { TwoBit: 4, FourBit: 2 } as const;
const Rgba = { Red: 0, Green: 1, Blue: 2, Alpha: 3 } as const;
const Bgra = { Blue: 0, Green: 1, Red: 2, Alpha: 3 } as const;
let decoder: Promise<TextureDecoder> | undefined;
const powerOfTwo = (value: number) => (value & (value - 1)) === 0;

// PVRTC1 padding applies independently at each mip, down to a 2x2 block footprint.
export async function decodePVRTC(
  format: number,
  width: number,
  height: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  const twoBit = format === Format.RGB2 || format === Format.RGBA2;
  const rgb = format === Format.RGB4 || format === Format.RGB2;
  if (
    !width ||
    !height ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS ||
    !powerOfTwo(width) ||
    !powerOfTwo(height)
  )
    throw Error(`Invalid PVRTC1 dimensions ${width}x${height}`);
  const paddedWidth = Math.max(width, twoBit ? MIN_WIDTH_TWO_BIT : MIN_BLOCK),
    paddedHeight = Math.max(height, MIN_BLOCK);
  if (
    data.byteLength !==
    (paddedWidth * paddedHeight) / (twoBit ? PixelsPerByte.TwoBit : PixelsPerByte.FourBit)
  )
    throw Error("Incorrect PVRTC1 mip size");
  decoder ??= createDecoder();
  const bgra = (await decoder).decode_pvrtc(data, paddedWidth, paddedHeight, twoBit);
  if (bgra?.length !== paddedWidth * paddedHeight * RGBA_BYTES)
    throw Error("Could not decode PVRTC1 texture");
  const output = new Uint8Array(width * height * RGBA_BYTES);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * paddedWidth + x) * RGBA_BYTES,
        target = (y * width + x) * RGBA_BYTES;
      output[target + Rgba.Red] = bgra[source + Bgra.Red] ?? 0;
      output[target + Rgba.Green] = bgra[source + Bgra.Green] ?? 0;
      output[target + Rgba.Blue] = bgra[source + Bgra.Blue] ?? 0;
      output[target + Rgba.Alpha] = rgb ? OPAQUE : (bgra[source + Bgra.Alpha] ?? 0);
    }
  return output;
}
